import type { Metadata } from "next";
import { ContactEmail, LegalDocument, LegalLink, LegalList, LegalSection, Term } from "@/components/legal/legal-document";
import { MIN_AGE, OPERATOR_NAME, SUBMISSION_RETENTION_DAYS } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      intro={
        <>
          <p>
            This policy explains what {OPERATOR_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) collects when you use Beathoven at beathoven.io,
            why we collect it, who can see it, how long we keep it and what you can do about it. We&apos;ve tried to keep it short and
            to describe only what the app actually does.
          </p>
          <p>
            Beathoven is in beta. If what the app does changes in a way that affects your data, we&apos;ll update this page. Using
            Beathoven also means agreeing to our <LegalLink href="/terms">Terms of Service</LegalLink>.
          </p>
        </>
      }
    >
      <LegalSection title="The short version">
        <LegalList>
          <li>We collect what you need to play: an account, your profile, the tracks you upload, your chat messages and your ratings.</li>
          <li>Your profile, stats and Top tracks are public. Your tracks and chat are shared with the people in your rooms.</li>
          <li>
            Uploaded audio is deleted {SUBMISSION_RETENTION_DAYS} days after its room closes, except the latest version of each track on
            your profile.
          </li>
          <li>We count page views with privacy-friendly, cookie-free analytics. We don&apos;t run ad trackers, and we don&apos;t sell your data.</li>
          <li>
            Email <ContactEmail /> to see, fix or delete your data.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="What we collect">
        <LegalList>
          <li>
            <Term>Google sign-in.</Term> When you continue with Google, Google shares your email address, name and profile picture with
            our sign-in provider. We use your email to identify your account and show it to you in your account menu, and your name to
            suggest a display name when you set up your profile. Other players never see your email.
          </li>
          <li>
            <Term>Guest play.</Term> Playing as a guest creates an anonymous account with no email, tied to the sign-in session in your
            browser. If you sign out or clear your browser data, you lose access to it. Signing in with Google later creates a new,
            separate account.
          </li>
          <li>
            <Term>Your profile.</Term> Display name, username, bio, up to three DAWs, one profile link and an avatar, if you add them.
            Avatars are re-encoded on our servers into a small square image, which removes embedded metadata such as camera details and
            location.
          </li>
          <li>
            <Term>Game activity.</Term> Rooms you create or join and their settings, when you ready up, the ratings you give, votes to skip
            a track or kick a player, results, wins and games played.
          </li>
          <li>
            <Term>Uploaded tracks.</Term> The audio file plus details we work out from it: length, file type, file size, a file hash, a
            simplified waveform, the clip you choose to play and an audio fingerprint (see below). Each track gets a title from the
            file&apos;s embedded title or its file name, which you can rename. We remove ID3 and APE tags from MP3s and rebuild WAV files
            without their extra metadata. Other formats, such as FLAC, OGG and M4A, may keep metadata embedded by your software, so check
            your export settings if that matters to you.
          </li>
          <li>
            <Term>Chat messages</Term> you send in rooms, including emoji reactions.
          </li>
          <li>
            <Term>Profile link checks.</Term> When you save a profile link, we check it against our own list of blocked domains and may
            send the URL to Google Safe Browsing to check for malware and phishing. We record each attempt for an hour to limit you to 10
            per hour, and the time each URL was last checked. Visitors who click your link pass through a beathoven.io/out page that
            re-checks it.
          </li>
          <li>
            <Term>Presence.</Term> While Beathoven is open, your browser tells our realtime service that you&apos;re online. This drives
            the online count and the online indicator on your profile card, and it isn&apos;t stored. While you&apos;re in a room, your
            browser also checks in every 10 seconds, and we store when it last did so that idle players can be removed from lobbies.
          </li>
          <li>
            <Term>Technical data.</Term> Our hosting and database providers process your IP address, browser details and request logs to
            deliver the site, keep it secure and limit abuse, for example by limiting how many guest accounts one IP address can create.
            When someone who isn&apos;t signed in plays a Top track, we keep a one-way hash of their IP address for about a minute to
            limit streaming requests.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Audio fingerprints and file checks">
        <p>
          After a track uploads, our servers compute an audio fingerprint of it with the open-source Chromaprint tool. A fingerprint is
          a compact summary of how the audio sounds, not a copy of it. We compare it only with your own earlier uploads, so the same song
          uploaded twice counts as one track on your Top tracks, with its plays, games, wins and ratings combined. You can merge or split
          tracks yourself.
        </p>
        <p>
          Separately, we compare each upload&apos;s exact file hash against a list of files we&apos;ve blocked, for example after a
          copyright complaint, so a removed file can&apos;t simply be uploaded again.
        </p>
      </LegalSection>

      <LegalSection title="Who can see what">
        <LegalList>
          <li>
            <Term>Anyone, signed in or not:</Term> your profile (display name, username, avatar, bio, DAWs and profile link), when you
            joined, your stats and leaderboard position, and your Top tracks with their titles and stats. The latest version of each Top
            track can be played from your profile once the game it was played in reached results.
          </li>
          <li>
            <Term>Anyone browsing lobbies:</Term> public rooms, with the room name, host, mode, genre and player count.
          </li>
          <li>
            <Term>People in your room:</Term> your chat messages and your tracks. While tracks play, the producer stays hidden unless the
            host turns on producer names. Everyone sees who made what at results. People who were in a room can still open its tracks and
            chat after they leave.
          </li>
          <li>
            <Term>Only you:</Term> your email address and your individual ratings. Other players see totals, never who gave which rating.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Why we use it">
        <p>Where privacy laws like the GDPR ask for a legal basis, these are ours:</p>
        <LegalList>
          <li>
            <Term>To provide Beathoven</Term> (performing our agreement with you): accounts, profiles, rooms, playback, rating, results,
            leaderboards and Top tracks.
          </li>
          <li>
            <Term>To keep it safe and fair</Term> (our legitimate interests): rate limits, file and link checks, kicks and room bans,
            removing infringing content and investigating abuse.
          </li>
          <li>
            <Term>To meet legal obligations</Term>, such as responding to valid legal requests and copyright notices.
          </li>
        </LegalList>
        <p>We don&apos;t use your data for advertising, and we don&apos;t sell or share it for cross-context behavioural advertising.</p>
      </LegalSection>

      <LegalSection title="Services we use">
        <p>We rely on a few providers who process data for us under their own security and privacy terms:</p>
        <LegalList>
          <li>
            <Term>Supabase</Term> for the database, sign-in, file storage and realtime updates.
          </li>
          <li>
            <Term>Vercel</Term> for hosting the site, running our server code and scheduled cleanup jobs, and counting page views with Vercel Web Analytics. It doesn&apos;t use cookies and doesn&apos;t identify you across sites; it records the page, referrer, browser, device type and country, and discards your IP address.
          </li>
          <li>
            <Term>Google</Term> for Google sign-in and, when enabled, Safe Browsing link checks.
          </li>
        </LegalList>
        <p>We don&apos;t use advertising or social media trackers.</p>
      </LegalSection>

      <LegalSection title="Cookies and local storage">
        <LegalList>
          <li>
            <Term>Sign-in cookies</Term> keep you signed in, as a guest or with Google. Beathoven doesn&apos;t work without them.
          </li>
          <li>
            <Term>Local storage</Term> in your browser remembers your volume and mute setting, your visualizer preferences and your flame
            effect style. This stays on your device and isn&apos;t sent to us.
          </li>
        </LegalList>
        <p>We don&apos;t use tracking or advertising cookies, so there&apos;s nothing to opt out of.</p>
      </LegalSection>

      <LegalSection title="How long we keep it">
        <LegalList>
          <li>
            <Term>Audio files</Term> are deleted {SUBMISSION_RETENTION_DAYS} days after their room closes, which happens when the last
            player leaves. Our cleanup runs once a day, so it can take up to a day longer. The exception is the latest version of each
            track on your Top tracks, which we keep so it stays playable until you delete your account.
          </li>
          <li>
            <Term>Uploads that fail our checks</Term> are deleted within about a day.
          </li>
          <li>
            <Term>Track details</Term> (title, stats, waveform, file hash and fingerprint) stay after the audio file is deleted, so your
            stats keep working.
          </li>
          <li>
            <Term>Your account, profile, chat messages, ratings and results</Term> are kept until you delete your account. We don&apos;t
            currently delete chat messages automatically.
          </li>
          <li>
            <Term>Rate-limit records</Term> are kept for a minute to an hour.
          </li>
        </LegalList>
        <p>Our providers may keep backups for a limited time after data is deleted.</p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          You can edit or remove your display name, username, bio, DAWs, profile link and avatar at any time from your profile. You can
          also ask us to:
        </p>
        <LegalList>
          <li>give you a copy of your data,</li>
          <li>correct anything that&apos;s wrong,</li>
          <li>delete your account and everything tied to it, including your profile, tracks, chat messages, ratings and stats,</li>
          <li>stop or limit a use of your data you object to.</li>
        </LegalList>
        <p>
          There&apos;s no delete button yet, so email <ContactEmail /> from the address you sign in with, or include your username. We
          may ask you to confirm the account is yours, and we&apos;ll reply within 30 days. Guest accounts have no email, so tell us your
          username. You can also complain to your local data protection authority.
        </p>
      </LegalSection>

      <LegalSection title="Children">
        <p>
          Beathoven isn&apos;t directed at children under {MIN_AGE}, and you must be at least {MIN_AGE} to use it. If you believe a
          child under {MIN_AGE} has given us personal data, email <ContactEmail /> and we&apos;ll delete it.
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Uploads land in a private holding area and are checked on our servers before anyone can play them. Track files are stored
          privately and played through short-lived links. Database access is restricted per user, and all traffic uses HTTPS. No
          service is perfectly secure, but we work to protect your data and will tell you if a breach affects you where the law requires.
        </p>
      </LegalSection>

      <LegalSection title="International transfers">
        <p>
          Our providers are based in the United States and may process data there and in other countries. If you use Beathoven from
          outside the United States, your data will be transferred there. Where the law requires, we rely on safeguards such as the
          Standard Contractual Clauses offered by our providers.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          If we change this policy, we&apos;ll update the date at the top. If a change is significant, we&apos;ll also let you know in the
          app before it takes effect.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          {OPERATOR_NAME} is responsible for your data. Questions or requests: <ContactEmail />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
