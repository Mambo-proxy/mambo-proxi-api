// Demandes, historique, candidatures et rendez-vous de démonstration (écrans Demandes, Recrutement, Rendez-vous).
// Références `MP-AAAA-NNNN` : numéros des mocks (0085 à 0161) dans l'année du lancement ; le compteur annuel est
// porté au dernier numéro utilisé pour que la première vraie demande prenne le suivant.
import { AttachmentKind, Language, ScanStatus } from '../../../src/generated/prisma/client.js';
import { requestSearchText } from '../../../src/modules/requests/request-search.js';
import { logCount, mapId, readSeedData, type IdMap, type SeedClock, type Tx } from '../support.js';
import type { AppointmentSeed, RequestSeed } from '../types.js';
import type { CatalogueIds } from './catalogue.js';
import type { ContactIds } from './contacts.js';

const HOUR = 3_600_000;

export async function seedRequests(
  tx: Tx,
  clock: SeedClock,
  users: IdMap,
  catalogue: CatalogueIds,
  contacts: ContactIds,
): Promise<void> {
  const requests = readSeedData<RequestSeed[]>('requests');
  const appointments = readSeedData<AppointmentSeed[]>('appointments');
  let applications = 0;

  for (const request of requests) {
    const contactId = contacts.get(request.contactId);
    if (!contactId) throw new Error(`Contact inconnu pour la demande ${request.id} : ${request.contactId}.`);
    const data = {
      type: request.type,
      status: request.status,
      contactId,
      categoryId: mapId(catalogue.categories, request.categoryId),
      serviceId: mapId(catalogue.services, request.serviceId),
      jobOfferId: request.jobOfferId,
      trainingId: request.trainingId,
      otherTraining: request.otherTraining,
      eventId: request.eventId,
      seats: request.seats,
      participants: request.participants,
      period: request.period,
      organization: request.organization,
      partnershipType: request.partnershipType,
      contactPreference: request.contactPreference,
      subject: request.subject,
      payload: request.payload,
      message: request.message,
      language: Language.FR,
      consentAt: clock.date(request.consentAt),
      assignedToId: mapId(users, request.assignedToId),
      assignedAt: clock.optionalDate(request.assignedAt),
      dueAt: clock.optionalDate(request.dueAt),
      completedAt: clock.optionalDate(request.completedAt),
      closedAt: clock.optionalDate(request.closedAt),
      createdAt: clock.date(request.createdAt),
      isDemo: true,
    };
    // La référence d'une demande existante n'est jamais modifiée (relance une autre année).
    const reference = clock.reference(request.referenceNumber);
    const saved = await tx.request.upsert({
      where: { id: request.id },
      update: data,
      create: {
        ...data,
        id: request.id,
        reference,
        searchText: requestSearchText(reference, request.subject),
      },
      select: { reference: true, searchText: true },
    });
    const searchText = requestSearchText(saved.reference, request.subject);
    if (saved.searchText !== searchText)
      await tx.request.update({ where: { id: request.id }, data: { searchText }, select: { id: true } });

    // Historique : remplacé à chaque lancement.
    await tx.requestEvent.deleteMany({ where: { requestId: request.id } });
    await tx.requestEvent.createMany({
      data: request.history.map((event) => ({
        id: event.id,
        requestId: request.id,
        kind: event.kind,
        data:
          event.data && 'assignedToId' in event.data
            ? { assignedToId: mapId(users, event.data['assignedToId']) }
            : (event.data ?? undefined),
        actorId: mapId(users, event.actorId),
        createdAt: clock.date(event.createdAt),
      })),
    });

    if (request.application) {
      const { attachment, ...application } = request.application;
      // CV de démonstration : la pièce jointe est décrite, aucun fichier n'est déposé dans le stockage privé.
      const attachmentData = {
        requestId: request.id,
        kind: AttachmentKind.CV,
        fileName: attachment.fileName,
        mimeType: attachment.mimeType,
        size: attachment.size,
        scanStatus: ScanStatus.SKIPPED,
        createdAt: clock.date(request.createdAt),
      };
      await tx.attachment.upsert({
        where: { id: attachment.id },
        update: attachmentData,
        create: { ...attachmentData, id: attachment.id, storageKey: attachment.storageKey },
      });
      const applicationData = {
        jobOfferId: request.jobOfferId,
        status: application.status,
        readAt:
          application.readAt === null ? null : new Date(clock.date(application.readAt).getTime() + HOUR),
        createdAt: clock.date(request.createdAt),
      };
      await tx.jobApplication.upsert({
        where: { id: application.id },
        update: applicationData,
        create: {
          ...applicationData,
          id: application.id,
          requestId: request.id,
          cvAttachmentId: attachment.id,
        },
      });
      applications += 1;
    }
  }
  logCount('Demandes', requests.length - applications);
  logCount('Candidatures', applications);

  for (const appointment of appointments) {
    const contactId = contacts.get(appointment.contactId);
    if (!contactId)
      throw new Error(`Contact inconnu pour le rendez-vous ${appointment.id} : ${appointment.contactId}.`);
    const data = {
      requestId: appointment.requestId,
      contactId,
      reason: appointment.reason,
      format: appointment.format,
      startsAt: clock.date(appointment.startsAt),
      endsAt: clock.date(appointment.endsAt),
      status: appointment.status,
      proposedStartsAt: clock.optionalDate(appointment.proposedStartsAt),
      location: appointment.location,
      videoLink: appointment.videoLink,
      message: appointment.message,
      notes: appointment.notes,
      language: Language.FR,
      assignedToId: mapId(users, appointment.assignedToId),
      confirmedAt: clock.optionalDate(appointment.confirmedAt),
      cancelledAt: clock.optionalDate(appointment.cancelledAt),
      completedAt: clock.optionalDate(appointment.completedAt),
      reminderSentAt: clock.optionalDate(appointment.reminderSentAt),
      createdAt: clock.date(appointment.createdAt),
      isDemo: true,
    };
    await tx.appointment.upsert({
      where: { id: appointment.id },
      update: data,
      create: { ...data, id: appointment.id, reference: clock.reference(appointment.referenceNumber) },
    });
  }
  logCount('Rendez-vous', appointments.length);

  // Compteur annuel des références : jamais en dessous du dernier numéro de démonstration.
  const last = Math.max(
    ...requests.map((request) => request.referenceNumber),
    ...appointments.map((appointment) => appointment.referenceNumber),
  );
  const counter = await tx.referenceCounter.upsert({
    where: { year: clock.year },
    update: {},
    create: { year: clock.year, lastValue: last },
  });
  if (counter.lastValue < last)
    await tx.referenceCounter.update({ where: { year: clock.year }, data: { lastValue: last } });
  logCount(`Compteur des références ${clock.year}`, Math.max(counter.lastValue, last));
}
