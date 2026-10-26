import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Text,
} from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';
import type { MailLink, MailView, SummaryRow } from '../mail-view.js';
import {
  CARD_WIDTH,
  GOOGLE_FONTS_URL,
  LOGO_HEIGHT,
  LOGO_WIDTH,
  mailColors,
  mailFonts,
  ribbonGradient,
} from './theme.js';

/**
 * Gabarit commun des e-mails (maquettes `qa/reference/emails/*.png` du site) : fond `neutral/100`, carte blanche
 * de 600 px au rayon 20, logo horizontal centré, ruban `gradient/lien`, titre Poppins, texte Inter, récapitulatif
 * sur fond `neutral/50`, bouton orange pleine largeur, signature, pied de page gris avec les coordonnées.
 * Variantes : bloc récapitulatif (devis, carte de rendez-vous…), étoiles du questionnaire, code OTP, corps de
 * campagne. React Email produit des tableaux et des styles en ligne, lus par les clients de messagerie.
 */

const SIDE_PADDING = 44;

const styles = {
  body: {
    margin: 0,
    padding: '40px 12px',
    backgroundColor: mailColors.pageBackground,
    fontFamily: mailFonts.ui,
    color: mailColors.text,
  },
  card: {
    maxWidth: `${CARD_WIDTH}px`,
    width: '100%',
    backgroundColor: mailColors.card,
    borderRadius: '20px',
    overflow: 'hidden',
  },
  header: { padding: '28px 24px 26px', textAlign: 'center' },
  ribbon: {
    height: '4px',
    lineHeight: '4px',
    fontSize: '1px',
    backgroundColor: mailColors.ribbonFallback,
    backgroundImage: ribbonGradient,
  },
  content: { padding: `40px ${SIDE_PADDING}px 36px` },
  title: {
    margin: '0 0 20px',
    fontFamily: mailFonts.brand,
    fontSize: '26px',
    lineHeight: '34px',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    color: mailColors.text,
  },
  paragraph: {
    margin: '0 0 16px',
    fontSize: '16px',
    lineHeight: '26px',
    color: mailColors.textMuted,
  },
  summary: {
    margin: '8px 0 20px',
    backgroundColor: mailColors.sunken,
    borderRadius: '12px',
  },
  summaryCell: { padding: '16px 20px' },
  summaryLabel: {
    padding: '4px 0',
    fontSize: '14px',
    lineHeight: '22px',
    color: mailColors.textMuted,
    textAlign: 'left',
    verticalAlign: 'top',
  },
  summaryValue: {
    padding: '4px 0 4px 16px',
    fontSize: '14px',
    lineHeight: '22px',
    fontWeight: 600,
    color: mailColors.text,
    textAlign: 'right',
    verticalAlign: 'top',
  },
  code: {
    margin: '8px 0 20px',
    padding: '18px 12px',
    backgroundColor: mailColors.sunken,
    borderRadius: '12px',
    fontFamily: mailFonts.brand,
    fontSize: '32px',
    lineHeight: '40px',
    fontWeight: 600,
    letterSpacing: '8px',
    textAlign: 'center',
    color: mailColors.text,
  },
  stars: { margin: '4px 0 20px', textAlign: 'center' },
  star: {
    display: 'inline-block',
    padding: '0 4px',
    fontSize: '34px',
    lineHeight: '40px',
    color: mailColors.primary,
    textDecoration: 'none',
  },
  button: {
    display: 'block',
    boxSizing: 'border-box',
    width: '100%',
    padding: '14px 24px',
    backgroundColor: mailColors.primary,
    borderRadius: '12px',
    fontFamily: mailFonts.ui,
    fontSize: '16px',
    lineHeight: '22px',
    fontWeight: 600,
    color: mailColors.onPrimary,
    textAlign: 'center',
    textDecoration: 'none',
  },
  signature: {
    margin: '24px 0 0',
    fontSize: '14px',
    lineHeight: '20px',
    fontWeight: 600,
    color: mailColors.text,
  },
  campaign: { fontSize: '16px', lineHeight: '26px', color: mailColors.text },
  footer: { padding: '24px 24px 22px', backgroundColor: mailColors.sunken, textAlign: 'center' },
  footerLine: { margin: '0 0 8px', fontSize: '13px', lineHeight: '20px', color: mailColors.textMuted },
  notice: { margin: '4px 0 0', fontSize: '12px', lineHeight: '18px', color: mailColors.textMuted },
  link: { color: mailColors.textBrand, textDecoration: 'underline' },
} satisfies Record<string, CSSProperties>;

/**
 * Bloc d'une cellule de tableau pleine largeur : les marges intérieures sont portées par la cellule (`td`),
 * seule forme que respectent tous les clients (Outlook compris).
 */
function Block({
  style,
  children,
  hidden,
}: {
  style: CSSProperties;
  children: ReactNode;
  hidden?: boolean;
}): ReactNode {
  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      aria-hidden={hidden === true ? 'true' : undefined}
    >
      <tbody>
        <tr>
          <td style={style}>{children}</td>
        </tr>
      </tbody>
    </table>
  );
}

function Summary({ rows }: { rows: SummaryRow[] }): ReactNode {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0} style={styles.summary}>
      <tbody>
        <tr>
          <td style={styles.summaryCell}>
            <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} border={0}>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label}>
                    <td style={styles.summaryLabel}>{row.label}</td>
                    <td style={styles.summaryValue}>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

/** Cinq étoiles (décoratives) menant au questionnaire, comme sur la maquette « Invitation au questionnaire ». */
function RatingStars({ url, lang }: { url: string; lang: MailView['lang'] }): ReactNode {
  const label = lang === 'fr' ? 'Noter la prestation' : 'Rate the service';
  return (
    <Text style={styles.stars}>
      <Link href={url} aria-label={label} style={styles.star}>
        {'☆ ☆ ☆ ☆ ☆'}
      </Link>
    </Text>
  );
}

function ActionButton({ button }: { button: MailLink }): ReactNode {
  return (
    <Button href={button.url} style={styles.button}>
      {button.label}
    </Button>
  );
}

export function MailDocument({ view }: { view: MailView }): ReactNode {
  return (
    <Html lang={view.lang} dir="ltr">
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
        <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
      </Head>
      <Preview>{view.preheader}</Preview>
      <Body style={styles.body}>
        <Container style={styles.card}>
          <Block style={styles.header}>
            <Link href={view.webUrl}>
              <Img
                src={view.logoUrl}
                alt={view.logoAlt}
                width={LOGO_WIDTH}
                height={LOGO_HEIGHT}
                style={{ display: 'inline-block', margin: '0 auto' }}
              />
            </Link>
          </Block>
          <Block style={styles.ribbon} hidden>
            &nbsp;
          </Block>
          <Block style={styles.content}>
            {view.title !== null && (
              <Heading as="h1" style={styles.title}>
                {view.title}
              </Heading>
            )}
            {view.bodyHtml !== null && (
              <div style={styles.campaign} dangerouslySetInnerHTML={{ __html: view.bodyHtml }} />
            )}
            {view.paragraphs.map((paragraph, index) => (
              <Text key={index} style={styles.paragraph}>
                {paragraph}
              </Text>
            ))}
            {view.code !== null && <Text style={styles.code}>{view.code}</Text>}
            {view.summary.length > 0 && <Summary rows={view.summary} />}
            {view.ratingUrl !== null && <RatingStars url={view.ratingUrl} lang={view.lang} />}
            {view.button !== null && <ActionButton button={view.button} />}
            <Text style={styles.signature}>{view.signature}</Text>
          </Block>
          <Block style={styles.footer}>
            {view.footerLines.map((line) => (
              <Text key={line} style={styles.footerLine}>
                {line}
              </Text>
            ))}
            <Text style={styles.notice}>
              {view.notice}
              {view.unsubscribe !== null && (
                <>
                  {' '}
                  <Link href={view.unsubscribe.url} style={styles.link}>
                    {view.unsubscribe.label}
                  </Link>
                </>
              )}
            </Text>
          </Block>
        </Container>
      </Body>
    </Html>
  );
}
