-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'AGENT', 'EDITOR', 'WRITER');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('DEVIS', 'CONTACT', 'INFORMATION', 'INSCRIPTION', 'FORMATION', 'CANDIDATURE', 'PARTENARIAT', 'EVENEMENT', 'RENDEZ_VOUS');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('NOUVELLE', 'EN_COURS', 'PRESTATION_REALISEE', 'CLOTUREE');

-- CreateEnum
CREATE TYPE "RequestEventKind" AS ENUM ('RECEIVED', 'ACK_SENT', 'TEAM_ALERT_SENT', 'STATUS_CHANGED', 'ASSIGNED', 'NOTE_ADDED', 'SURVEY_SCHEDULED', 'SURVEY_SENT', 'SURVEY_REMINDED', 'SURVEY_ANSWERED', 'EMAIL_SENT', 'ANONYMIZED', 'DUPLICATED');

-- CreateEnum
CREATE TYPE "ContactProfile" AS ENUM ('PARTICULIER', 'PROFESSIONNEL');

-- CreateEnum
CREATE TYPE "ContactPreference" AS ENUM ('WHATSAPP', 'TELEPHONE', 'EMAIL');

-- CreateEnum
CREATE TYPE "PartnershipType" AS ENUM ('PRESTATAIRE_EXPERIENCE', 'IMMOBILIER', 'ENTREPRISE_PRESTATAIRE', 'AUTRE');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('A_CONFIRMER', 'CONFIRME', 'AUTRE_CRENEAU_PROPOSE', 'ANNULE', 'TERMINE');

-- CreateEnum
CREATE TYPE "AppointmentFormat" AS ENUM ('AGENCE', 'TELEPHONE', 'VISIO');

-- CreateEnum
CREATE TYPE "AppointmentReason" AS ENUM ('DEVIS', 'IMMOBILIER', 'PARTENARIAT', 'RECRUTEMENT', 'AUTRE');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('A_VALIDER', 'PUBLIE', 'MASQUE');

-- CreateEnum
CREATE TYPE "SurveyQuestionKind" AS ENUM ('STARS', 'CHOICE', 'NPS', 'TEXT');

-- CreateEnum
CREATE TYPE "SurveyStatus" AS ENUM ('SCHEDULED', 'SENT', 'REMINDED', 'ANSWERED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NOUVEAU', 'LU', 'RETENU', 'REFUSE');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('BROUILLON', 'PROGRAMMEE', 'EN_COURS_ENVOI', 'ENVOYEE', 'ANNULEE');

-- CreateEnum
CREATE TYPE "CampaignSegmentKind" AS ENUM ('ALL', 'FRANCE', 'CAMEROUN', 'PROFESSIONNELS', 'TAGS');

-- CreateEnum
CREATE TYPE "SubscriberStatus" AS ENUM ('EN_ATTENTE', 'CONFIRME', 'DESINSCRIT');

-- CreateEnum
CREATE TYPE "SubscriberSource" AS ENUM ('footer', 'suivi-mambo', 'inscription', 'autre');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "CategoryTint" AS ENUM ('orange-50', 'neutral-100', 'vert-50', 'neutral-900');

-- CreateEnum
CREATE TYPE "IllustrationScene" AS ENUM ('accueil', 'chef', 'colis', 'courses', 'culture', 'equipe', 'evenement', 'formation', 'livraison', 'logement', 'marche', 'massage', 'photo', 'portrait', 'voiture');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('SERVICE', 'FORMULA');

-- CreateEnum
CREATE TYPE "OfferAction" AS ENUM ('QUOTE', 'BOOKING');

-- CreateEnum
CREATE TYPE "ZoneTone" AS ENUM ('zone1', 'zone2', 'zone3', 'special');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('XAF', 'EUR');

-- CreateEnum
CREATE TYPE "SalaryPeriod" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "PartnerCategory" AS ENUM ('EXPERIENCE', 'IMMOBILIER', 'ENTREPRISES');

-- CreateEnum
CREATE TYPE "TrainingCategory" AS ENUM ('PROFESSIONNELS', 'ATELIERS', 'SENSIBILISATION');

-- CreateEnum
CREATE TYPE "MagazineEditionStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('REQUEST', 'APPOINTMENT', 'REVIEW', 'APPLICATION', 'PARTNERSHIP', 'REGISTRATION', 'ASSIGNMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "PageGroup" AS ENUM ('principales', 'formulaires', 'legales', 'systeme');

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaMimeType" AS ENUM ('image/jpeg', 'image/png', 'image/webp', 'image/svg+xml');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('CV', 'OTHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AnalyticsAction" AS ENUM ('quote', 'whatsapp', 'call', 'email', 'participate', 'newsletter', 'appointment', 'sign_up', 'contact', 'application', 'partner', 'training');

-- CreateEnum
CREATE TYPE "AnalyticsStep" AS ENUM ('click', 'submit');

-- CreateEnum
CREATE TYPE "Device" AS ENUM ('mobile', 'tablet', 'desktop', 'unknown');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EDITOR',
    "password_hash" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMPTZ(3),
    "invited_by_id" TEXT,
    "activated_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "last_active_at" TIMESTAMPTZ(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "replaced_by_id" TEXT,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "trusted_device_id" TEXT,
    "user_agent" TEXT,
    "ip" TEXT,
    "last_active_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "label" TEXT,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "resend_available_at" TIMESTAMPTZ(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_resets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "requested_by" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_resets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "label" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "slug_en" TEXT,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "eyebrow" TEXT,
    "hero_title" TEXT NOT NULL,
    "hero_lead" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "icon_color" TEXT,
    "tint" "CategoryTint" NOT NULL,
    "illustration" "IllustrationScene" NOT NULL DEFAULT 'accueil',
    "image_id" TEXT,
    "visuals" JSONB,
    "home_card" JSONB,
    "audiences_title" TEXT,
    "audiences" JSONB NOT NULL DEFAULT '[]',
    "services_title" TEXT,
    "services_lead" TEXT,
    "groups" JSONB NOT NULL DEFAULT '[]',
    "highlight" JSONB,
    "process_eyebrow" TEXT,
    "process_title" TEXT,
    "process_steps" JSONB NOT NULL DEFAULT '[]',
    "testimonial_id" TEXT,
    "quote_fields" JSONB NOT NULL DEFAULT '[]',
    "cta_title" TEXT,
    "cta_text" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_offer_sections" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "eyebrow" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "title_mobile" TEXT,
    "lead" TEXT,
    "lead_mobile" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "translations" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_offer_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "slug_en" TEXT,
    "name" TEXT NOT NULL,
    "short_name" TEXT,
    "category_id" TEXT NOT NULL,
    "kind" "ServiceKind" NOT NULL DEFAULT 'SERVICE',
    "tagline" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "icon" TEXT NOT NULL DEFAULT 'Sparkles',
    "illustration" "IllustrationScene" NOT NULL DEFAULT 'accueil',
    "cover_image_id" TEXT,
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audiences" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "steps" JSONB NOT NULL DEFAULT '[]',
    "advantages" JSONB NOT NULL DEFAULT '[]',
    "faq" JSONB NOT NULL DEFAULT '[]',
    "quote_bullets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "offers_eyebrow" TEXT,
    "offers_title" TEXT,
    "offers_lead" TEXT,
    "offers_lead_mobile" TEXT,
    "show_in_menu" BOOLEAN NOT NULL DEFAULT true,
    "featured_on_home" BOOLEAN NOT NULL DEFAULT false,
    "show_whatsapp" BOOLEAN NOT NULL DEFAULT true,
    "reviews_title" TEXT,
    "related_title" TEXT,
    "cta_title" TEXT,
    "cta_text" TEXT,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "to_complete" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3),
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_gallery_images" (
    "service_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "alt" TEXT,

    CONSTRAINT "service_gallery_images_pkey" PRIMARY KEY ("service_id","media_id")
);

-- CreateTable
CREATE TABLE "service_relations" (
    "service_id" TEXT NOT NULL,
    "related_service_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_relations_pkey" PRIMARY KEY ("service_id","related_service_id")
);

-- CreateTable
CREATE TABLE "service_featured_reviews" (
    "service_id" TEXT NOT NULL,
    "review_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "service_featured_reviews_pkey" PRIMARY KEY ("service_id","review_id")
);

-- CreateTable
CREATE TABLE "service_offers" (
    "id" TEXT NOT NULL,
    "service_id" TEXT,
    "section_id" TEXT,
    "target_service_id" TEXT,
    "title" TEXT NOT NULL,
    "title_mobile" TEXT,
    "text" TEXT NOT NULL,
    "text_mobile" TEXT,
    "icon" TEXT,
    "illustration" "IllustrationScene" NOT NULL DEFAULT 'accueil',
    "image_id" TEXT,
    "action" "OfferAction" NOT NULL,
    "action_label" TEXT NOT NULL,
    "action_label_mobile" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redirects" (
    "id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "permanent" BOOLEAN NOT NULL DEFAULT true,
    "entity" TEXT,
    "entity_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pages" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "group" "PageGroup" NOT NULL DEFAULT 'principales',
    "sections" JSONB NOT NULL DEFAULT '[]',
    "seo" JSONB,
    "translations" JSONB,
    "draft_sections" JSONB,
    "draft_seo" JSONB,
    "draft_translations" JSONB,
    "draft_updated_at" TIMESTAMPTZ(3),
    "allowed_sections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pages_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "translations" JSONB,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "email_templates" (
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "title" TEXT NOT NULL,
    "paragraphs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "button_label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "translations" JSONB,
    "updated_by_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_templates_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "revalidation_requests" (
    "id" TEXT NOT NULL,
    "tags" TEXT[],
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revalidation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'RUNNING',
    "storage_key" TEXT,
    "size_bytes" BIGINT,
    "error" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media" (
    "id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" "MediaMimeType" NOT NULL,
    "size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "alt" TEXT NOT NULL,
    "focal_x" DOUBLE PRECISION,
    "focal_y" DOUBLE PRECISION,
    "blur_data_url" TEXT,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "status" "MediaStatus" NOT NULL DEFAULT 'PROCESSING',
    "checksum" TEXT,
    "uploaded_by_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_usages" (
    "id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "slot" TEXT NOT NULL DEFAULT '',
    "label" TEXT NOT NULL,
    "href" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_usages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zones" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "tone" "ZoneTone" NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "description_en" TEXT,
    "result" TEXT NOT NULL DEFAULT '',
    "result_en" TEXT,
    "delay" TEXT,
    "fee_amount" INTEGER,
    "fee_currency" "Currency" DEFAULT 'XAF',
    "fee_from" BOOLEAN NOT NULL DEFAULT false,
    "area" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zone_quarters" (
    "id" TEXT NOT NULL,
    "zone_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "detail" TEXT,
    "detail_en" TEXT,
    "map_label" TEXT,
    "map_label_en" TEXT,
    "is_base" BOOLEAN NOT NULL DEFAULT false,
    "label_on_small_map" BOOLEAN NOT NULL DEFAULT false,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "map_x" DOUBLE PRECISION,
    "map_y" DOUBLE PRECISION,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "zone_quarters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "city" TEXT,
    "district" TEXT,
    "profile" "ContactProfile" NOT NULL DEFAULT 'PARTICULIER',
    "organization" TEXT,
    "activity" TEXT,
    "preferred_channel" "ContactPreference",
    "source" TEXT,
    "language" "Language" NOT NULL DEFAULT 'fr',
    "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "anonymized_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_interests" (
    "contact_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,

    CONSTRAINT "contact_interests_pkey" PRIMARY KEY ("contact_id","category_id")
);

-- CreateTable
CREATE TABLE "reference_counters" (
    "year" INTEGER NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reference_counters_pkey" PRIMARY KEY ("year")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "RequestType" NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'NOUVELLE',
    "contact_id" TEXT NOT NULL,
    "category_id" TEXT,
    "service_id" TEXT,
    "job_offer_id" TEXT,
    "training_id" TEXT,
    "other_training" TEXT,
    "event_id" TEXT,
    "seats" INTEGER,
    "participants" INTEGER,
    "period" TEXT,
    "organization" TEXT,
    "partnership_type" "PartnershipType",
    "contact_preference" "ContactPreference",
    "subject" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "message" TEXT,
    "language" "Language" NOT NULL DEFAULT 'fr',
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "assigned_to_id" TEXT,
    "assigned_at" TIMESTAMPTZ(3),
    "due_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "anonymized_at" TIMESTAMPTZ(3),
    "duplicated_from_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_notes" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "request_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" "RequestEventKind" NOT NULL,
    "data" JSONB,
    "actor_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'OTHER',
    "storage_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT,
    "scan_status" "ScanStatus" NOT NULL DEFAULT 'SKIPPED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "request_id" TEXT,
    "contact_id" TEXT NOT NULL,
    "reason" "AppointmentReason" NOT NULL,
    "format" "AppointmentFormat" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'A_CONFIRMER',
    "proposed_starts_at" TIMESTAMPTZ(3),
    "proposal_token_hash" TEXT,
    "proposal_expires_at" TIMESTAMPTZ(3),
    "location" TEXT,
    "video_link" TEXT,
    "message" TEXT,
    "notes" TEXT,
    "language" "Language" NOT NULL DEFAULT 'fr',
    "assigned_to_id" TEXT,
    "created_by_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "reminder_sent_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,
    "slot_minutes" INTEGER NOT NULL DEFAULT 90,
    "formats" "AppointmentFormat"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT true,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "label" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "surveys" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" "SurveyStatus" NOT NULL DEFAULT 'SCHEDULED',
    "language" "Language" NOT NULL DEFAULT 'fr',
    "scheduled_for" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "reminded_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "answers" JSONB,
    "rating" INTEGER,
    "nps_score" INTEGER,
    "publish_consent" BOOLEAN NOT NULL DEFAULT false,
    "display_name" TEXT,
    "city" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "survey_questions" (
    "id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "kind" "SurveyQuestionKind" NOT NULL,
    "label" TEXT NOT NULL,
    "help_text" TEXT,
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "translations" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "survey_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "city" TEXT,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "excerpt" TEXT,
    "service_id" TEXT,
    "survey_id" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'A_VALIDER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publish_consent" BOOLEAN NOT NULL DEFAULT false,
    "answers_snapshot" JSONB,
    "service_date" TIMESTAMPTZ(3),
    "date" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reply" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "replied_by_id" TEXT,
    "published_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PartnerCategory" NOT NULL,
    "logo_image_id" TEXT,
    "url" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trainings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "TrainingCategory" NOT NULL,
    "audience_label" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "location" TEXT,
    "description" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'PUBLISHED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "trainings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_offers" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL,
    "contract_type" TEXT NOT NULL,
    "start_date" TEXT,
    "working_time" TEXT,
    "location_label" TEXT,
    "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salary_min" INTEGER,
    "salary_max" INTEGER,
    "salary_currency" "Currency",
    "salary_period" "SalaryPeriod",
    "schedule" TEXT,
    "summary" TEXT NOT NULL,
    "description" TEXT,
    "missions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "profile" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applications" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "job_offer_id" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NOUVEAU',
    "cv_attachment_id" TEXT NOT NULL,
    "notes" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "city" TEXT NOT NULL,
    "place" TEXT,
    "tag" TEXT NOT NULL,
    "illustration" "IllustrationScene" NOT NULL DEFAULT 'evenement',
    "image_id" TEXT,
    "description" TEXT,
    "capacity" INTEGER,
    "limited" BOOLEAN NOT NULL DEFAULT false,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMPTZ(3),
    "translations" JSONB,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magazine_editions" (
    "id" TEXT NOT NULL,
    "number" INTEGER,
    "title" TEXT NOT NULL,
    "title_en" TEXT,
    "subtitle" TEXT,
    "subtitle_en" TEXT,
    "themes" TEXT,
    "publish_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "status" "MagazineEditionStatus" NOT NULL DEFAULT 'DRAFT',
    "cover_id" TEXT,
    "editorial" TEXT,
    "editorial_en" TEXT,
    "signature" TEXT,
    "signature_en" TEXT,
    "newsletter_scheduled_at" TIMESTAMPTZ(3),
    "newsletter_sent_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "magazine_editions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magazine_articles" (
    "id" TEXT NOT NULL,
    "edition_id" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "title_en" TEXT,
    "theme" TEXT NOT NULL,
    "theme_en" TEXT,
    "excerpt" TEXT,
    "excerpt_en" TEXT,
    "body" TEXT,
    "body_en" TEXT,
    "image_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "magazine_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "contact_id" TEXT,
    "status" "SubscriberStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "language" "Language" NOT NULL DEFAULT 'fr',
    "source" "SubscriberSource" NOT NULL DEFAULT 'footer',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "confirm_token_hash" TEXT,
    "confirm_token_expires" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "unsubscribed_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preheader" TEXT,
    "html" TEXT NOT NULL,
    "text" TEXT,
    "segment_kind" "CampaignSegmentKind" NOT NULL DEFAULT 'ALL',
    "segment_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "language" "Language",
    "magazine_edition_id" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'BROUILLON',
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER,
    "clicks" INTEGER,
    "unsubscribes" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_deliveries" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "subscriber_id" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "message_id" TEXT,
    "error" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "opened_at" TIMESTAMPTZ(3),
    "clicked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_page_views_daily" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "lang" "Language" NOT NULL,
    "device" "Device" NOT NULL DEFAULT 'unknown',
    "referrer_host" TEXT NOT NULL DEFAULT '',
    "consented" BOOLEAN NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_page_views_daily_pkey" PRIMARY KEY ("day","path","lang","device","referrer_host","consented")
);

-- CreateTable
CREATE TABLE "analytics_actions_daily" (
    "day" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "lang" "Language" NOT NULL,
    "device" "Device" NOT NULL DEFAULT 'unknown',
    "action" "AnalyticsAction" NOT NULL,
    "step" "AnalyticsStep" NOT NULL DEFAULT 'click',
    "target" TEXT NOT NULL DEFAULT '',
    "placement" TEXT NOT NULL DEFAULT '',
    "consented" BOOLEAN NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "analytics_actions_daily_pkey" PRIMARY KEY ("day","path","lang","device","action","step","target","placement","consented")
);

-- CreateTable
CREATE TABLE "analytics_visitors_daily" (
    "day" DATE NOT NULL,
    "visitor_hash" CHAR(64) NOT NULL,
    "path" TEXT NOT NULL,
    "lang" "Language" NOT NULL,

    CONSTRAINT "analytics_visitors_daily_pkey" PRIMARY KEY ("day","visitor_hash","path")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_role_is_active_idx" ON "users"("role", "is_active");

-- CreateIndex
CREATE INDEX "users_last_active_at_idx" ON "users"("last_active_at");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_hash_key" ON "sessions"("refresh_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_replaced_by_id_key" ON "sessions"("replaced_by_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_revoked_at_idx" ON "sessions"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_token_hash_key" ON "trusted_devices"("token_hash");

-- CreateIndex
CREATE INDEX "trusted_devices_user_id_idx" ON "trusted_devices"("user_id");

-- CreateIndex
CREATE INDEX "otp_challenges_user_id_created_at_idx" ON "otp_challenges"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "password_resets_token_hash_key" ON "password_resets"("token_hash");

-- CreateIndex
CREATE INDEX "password_resets_user_id_idx" ON "password_resets"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_user_id_idx" ON "invitations"("user_id");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_entity_id_idx" ON "audit_logs"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_en_key" ON "categories"("slug_en");

-- CreateIndex
CREATE INDEX "categories_status_sort_order_idx" ON "categories"("status", "sort_order");

-- CreateIndex
CREATE INDEX "category_offer_sections_category_id_sort_order_idx" ON "category_offer_sections"("category_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_en_key" ON "services"("slug_en");

-- CreateIndex
CREATE INDEX "services_category_id_status_sort_order_idx" ON "services"("category_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "services_status_featured_on_home_idx" ON "services"("status", "featured_on_home");

-- CreateIndex
CREATE INDEX "service_gallery_images_media_id_idx" ON "service_gallery_images"("media_id");

-- CreateIndex
CREATE INDEX "service_relations_related_service_id_idx" ON "service_relations"("related_service_id");

-- CreateIndex
CREATE INDEX "service_featured_reviews_review_id_idx" ON "service_featured_reviews"("review_id");

-- CreateIndex
CREATE INDEX "service_offers_service_id_sort_order_idx" ON "service_offers"("service_id", "sort_order");

-- CreateIndex
CREATE INDEX "service_offers_section_id_sort_order_idx" ON "service_offers"("section_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "redirects_from_path_key" ON "redirects"("from_path");

-- CreateIndex
CREATE INDEX "redirects_entity_entity_id_idx" ON "redirects"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "revalidation_requests_status_created_at_idx" ON "revalidation_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_runs_status_started_at_idx" ON "backup_runs"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_storage_key_key" ON "media"("storage_key");

-- CreateIndex
CREATE INDEX "media_status_created_at_idx" ON "media"("status", "created_at");

-- CreateIndex
CREATE INDEX "media_checksum_idx" ON "media"("checksum");

-- CreateIndex
CREATE INDEX "media_usages_kind_entity_id_idx" ON "media_usages"("kind", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_usages_media_id_kind_entity_id_slot_key" ON "media_usages"("media_id", "kind", "entity_id", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "zones_key_key" ON "zones"("key");

-- CreateIndex
CREATE INDEX "zones_active_sort_order_idx" ON "zones"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "zone_quarters_normalized_name_key" ON "zone_quarters"("normalized_name");

-- CreateIndex
CREATE INDEX "zone_quarters_zone_id_sort_order_idx" ON "zone_quarters"("zone_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_email_key" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_profile_created_at_idx" ON "contacts"("profile", "created_at");

-- CreateIndex
CREATE INDEX "contacts_country_idx" ON "contacts"("country");

-- CreateIndex
CREATE INDEX "contacts_district_idx" ON "contacts"("district");

-- CreateIndex
CREATE INDEX "contacts_last_activity_at_idx" ON "contacts"("last_activity_at");

-- CreateIndex
CREATE INDEX "contact_interests_category_id_idx" ON "contact_interests"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "requests_reference_key" ON "requests"("reference");

-- CreateIndex
CREATE INDEX "requests_type_status_created_at_idx" ON "requests"("type", "status", "created_at");

-- CreateIndex
CREATE INDEX "requests_status_due_at_idx" ON "requests"("status", "due_at");

-- CreateIndex
CREATE INDEX "requests_assigned_to_id_status_idx" ON "requests"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "requests_category_id_created_at_idx" ON "requests"("category_id", "created_at");

-- CreateIndex
CREATE INDEX "requests_service_id_created_at_idx" ON "requests"("service_id", "created_at");

-- CreateIndex
CREATE INDEX "requests_contact_id_idx" ON "requests"("contact_id");

-- CreateIndex
CREATE INDEX "requests_training_id_idx" ON "requests"("training_id");

-- CreateIndex
CREATE INDEX "requests_event_id_idx" ON "requests"("event_id");

-- CreateIndex
CREATE INDEX "requests_job_offer_id_idx" ON "requests"("job_offer_id");

-- CreateIndex
CREATE INDEX "requests_created_at_idx" ON "requests"("created_at");

-- CreateIndex
CREATE INDEX "request_notes_request_id_created_at_idx" ON "request_notes"("request_id", "created_at");

-- CreateIndex
CREATE INDEX "request_events_request_id_created_at_idx" ON "request_events"("request_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storage_key_key" ON "attachments"("storage_key");

-- CreateIndex
CREATE INDEX "attachments_request_id_idx" ON "attachments"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_reference_key" ON "appointments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_request_id_key" ON "appointments"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_proposal_token_hash_key" ON "appointments"("proposal_token_hash");

-- CreateIndex
CREATE INDEX "appointments_starts_at_idx" ON "appointments"("starts_at");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_assigned_to_id_starts_at_idx" ON "appointments"("assigned_to_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointments_contact_id_idx" ON "appointments"("contact_id");

-- CreateIndex
CREATE INDEX "availability_rules_weekday_idx" ON "availability_rules"("weekday");

-- CreateIndex
CREATE INDEX "availability_exceptions_date_idx" ON "availability_exceptions"("date");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_request_id_key" ON "surveys"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "surveys_token_hash_key" ON "surveys"("token_hash");

-- CreateIndex
CREATE INDEX "surveys_status_scheduled_for_idx" ON "surveys"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "surveys_completed_at_idx" ON "surveys"("completed_at");

-- CreateIndex
CREATE INDEX "survey_questions_active_sort_order_idx" ON "survey_questions"("active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_survey_id_key" ON "reviews"("survey_id");

-- CreateIndex
CREATE INDEX "reviews_status_date_idx" ON "reviews"("status", "date");

-- CreateIndex
CREATE INDEX "reviews_service_id_status_idx" ON "reviews"("service_id", "status");

-- CreateIndex
CREATE INDEX "reviews_featured_status_idx" ON "reviews"("featured", "status");

-- CreateIndex
CREATE INDEX "partners_category_visible_sort_order_idx" ON "partners"("category", "visible", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "trainings_slug_key" ON "trainings"("slug");

-- CreateIndex
CREATE INDEX "trainings_status_category_sort_order_idx" ON "trainings"("status", "category", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "job_offers_slug_key" ON "job_offers"("slug");

-- CreateIndex
CREATE INDEX "job_offers_status_published_at_idx" ON "job_offers"("status", "published_at");

-- CreateIndex
CREATE INDEX "job_offers_status_expires_at_idx" ON "job_offers"("status", "expires_at");

-- CreateIndex
CREATE INDEX "job_offers_city_idx" ON "job_offers"("city");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_request_id_key" ON "job_applications"("request_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applications_cv_attachment_id_key" ON "job_applications"("cv_attachment_id");

-- CreateIndex
CREATE INDEX "job_applications_status_created_at_idx" ON "job_applications"("status", "created_at");

-- CreateIndex
CREATE INDEX "job_applications_job_offer_id_status_idx" ON "job_applications"("job_offer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "magazine_editions_number_key" ON "magazine_editions"("number");

-- CreateIndex
CREATE INDEX "magazine_editions_status_publish_at_idx" ON "magazine_editions"("status", "publish_at");

-- CreateIndex
CREATE INDEX "magazine_articles_edition_id_sort_order_idx" ON "magazine_articles"("edition_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_contact_id_key" ON "subscribers"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscribers_confirm_token_hash_key" ON "subscribers"("confirm_token_hash");

-- CreateIndex
CREATE INDEX "subscribers_status_language_idx" ON "subscribers"("status", "language");

-- CreateIndex
CREATE INDEX "subscribers_created_at_idx" ON "subscribers"("created_at");

-- CreateIndex
CREATE INDEX "campaigns_status_scheduled_at_idx" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "campaigns_magazine_edition_id_idx" ON "campaigns"("magazine_edition_id");

-- CreateIndex
CREATE INDEX "campaigns_sent_at_idx" ON "campaigns"("sent_at");

-- CreateIndex
CREATE INDEX "campaign_deliveries_subscriber_id_idx" ON "campaign_deliveries"("subscriber_id");

-- CreateIndex
CREATE INDEX "campaign_deliveries_campaign_id_status_idx" ON "campaign_deliveries"("campaign_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_deliveries_campaign_id_subscriber_id_key" ON "campaign_deliveries"("campaign_id", "subscriber_id");

-- CreateIndex
CREATE INDEX "analytics_page_views_daily_day_idx" ON "analytics_page_views_daily"("day");

-- CreateIndex
CREATE INDEX "analytics_actions_daily_day_action_idx" ON "analytics_actions_daily"("day", "action");

-- CreateIndex
CREATE INDEX "analytics_visitors_daily_day_path_idx" ON "analytics_visitors_daily"("day", "path");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_trusted_device_id_fkey" FOREIGN KEY ("trusted_device_id") REFERENCES "trusted_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_testimonial_id_fkey" FOREIGN KEY ("testimonial_id") REFERENCES "reviews"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_offer_sections" ADD CONSTRAINT "category_offer_sections_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_cover_image_id_fkey" FOREIGN KEY ("cover_image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_gallery_images" ADD CONSTRAINT "service_gallery_images_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_gallery_images" ADD CONSTRAINT "service_gallery_images_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_relations" ADD CONSTRAINT "service_relations_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_relations" ADD CONSTRAINT "service_relations_related_service_id_fkey" FOREIGN KEY ("related_service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_featured_reviews" ADD CONSTRAINT "service_featured_reviews_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_featured_reviews" ADD CONSTRAINT "service_featured_reviews_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "category_offer_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_target_service_id_fkey" FOREIGN KEY ("target_service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pages" ADD CONSTRAINT "pages_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "zone_quarters" ADD CONSTRAINT "zone_quarters_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "zones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interests" ADD CONSTRAINT "contact_interests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_interests" ADD CONSTRAINT "contact_interests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_job_offer_id_fkey" FOREIGN KEY ("job_offer_id") REFERENCES "job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_training_id_fkey" FOREIGN KEY ("training_id") REFERENCES "trainings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_duplicated_from_id_fkey" FOREIGN KEY ("duplicated_from_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_notes" ADD CONSTRAINT "request_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_survey_id_fkey" FOREIGN KEY ("survey_id") REFERENCES "surveys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_replied_by_id_fkey" FOREIGN KEY ("replied_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_image_id_fkey" FOREIGN KEY ("logo_image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_offer_id_fkey" FOREIGN KEY ("job_offer_id") REFERENCES "job_offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_cv_attachment_id_fkey" FOREIGN KEY ("cv_attachment_id") REFERENCES "attachments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magazine_editions" ADD CONSTRAINT "magazine_editions_cover_id_fkey" FOREIGN KEY ("cover_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magazine_articles" ADD CONSTRAINT "magazine_articles_edition_id_fkey" FOREIGN KEY ("edition_id") REFERENCES "magazine_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magazine_articles" ADD CONSTRAINT "magazine_articles_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscribers" ADD CONSTRAINT "subscribers_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_magazine_edition_id_fkey" FOREIGN KEY ("magazine_edition_id") REFERENCES "magazine_editions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_deliveries" ADD CONSTRAINT "campaign_deliveries_subscriber_id_fkey" FOREIGN KEY ("subscriber_id") REFERENCES "subscribers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Contraintes non exprimables dans le schéma Prisma ───

-- Une offre appartient soit à une fiche service, soit à une section de rubrique (jamais aux deux, jamais à aucune).
ALTER TABLE "service_offers" ADD CONSTRAINT "service_offers_owner_check"
  CHECK (("service_id" IS NULL) <> ("section_id" IS NULL));

-- Un créneau ne peut être réservé qu'une fois tant que le rendez-vous est à confirmer ou confirmé (sinon 409).
CREATE UNIQUE INDEX "appointments_active_slot_key" ON "appointments" ("starts_at")
  WHERE "status" IN ('A_CONFIRMER', 'CONFIRME');

-- Bornes des valeurs saisies.
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "surveys" ADD CONSTRAINT "surveys_rating_check" CHECK ("rating" IS NULL OR "rating" BETWEEN 1 AND 5);
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_weekday_check" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "media" ADD CONSTRAINT "media_focal_check"
  CHECK (("focal_x" IS NULL OR "focal_x" BETWEEN 0 AND 1) AND ("focal_y" IS NULL OR "focal_y" BETWEEN 0 AND 1));
-- Quartiers : coordonnées dans l'emprise du Cameroun (inversion latitude/longitude refusée).
ALTER TABLE "zone_quarters" ADD CONSTRAINT "zone_quarters_coordinates_check"
  CHECK (("lat" IS NULL AND "lng" IS NULL)
    OR ("lat" BETWEEN 1.6 AND 13.1 AND "lng" BETWEEN 8.4 AND 16.2));
