import type { Metadata } from "next";
import { ContactEmail, LegalDocument, LegalLink, LegalList, LegalSection, Term } from "@/components/legal/legal-document";
import { GOVERNING_LAW, MIN_AGE, OPERATOR_NAME } from "@/lib/legal";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of Service"
      intro={
        <>
          <p>
            These terms are an agreement between you and {OPERATOR_NAME} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) about your use of
            Beathoven at beathoven.io. By playing as a guest, signing in or otherwise using Beathoven, you agree to them. If you
            don&apos;t agree, please don&apos;t use Beathoven.
          </p>
          <p>
            Our <LegalLink href="/privacy">Privacy Policy</LegalLink> explains what data we collect and how we use it.
          </p>
        </>
      }
    >
      <LegalSection title="Beta">
        <p>
          Beathoven is in beta. Features will change, things will break, and we may reset rooms, stats or leaderboards while we work
          on it. We&apos;ll try to give notice before big changes, but we can&apos;t promise to.
        </p>
      </LegalSection>

      <LegalSection title="Who can use Beathoven">
        <p>
          You must be at least {MIN_AGE} years old, or older if the law where you live sets a higher age for using online services
          without a parent&apos;s consent. If you&apos;re under 18, you need permission from a parent or guardian, and they agree to
          these terms for you. You can&apos;t use Beathoven if we&apos;ve previously banned you.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <LegalList>
          <li>
            You can sign in with Google or play as a guest. A guest account lives in your browser, so it&apos;s gone if you sign out or
            clear your browser data, and it doesn&apos;t carry over if you later sign in with Google.
          </li>
          <li>You&apos;re responsible for what happens on your account. One account per person, and don&apos;t share it.</li>
          <li>
            Don&apos;t pick a display name, username or avatar that impersonates someone or breaks the rules below. We may change or
            reclaim names that do.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Play fair and be decent">
        <p>When you use Beathoven, including chat, profiles and uploads, don&apos;t:</p>
        <LegalList>
          <li>harass, threaten, bully or demean anyone, or post hate speech;</li>
          <li>post sexual or graphically violent content, or anything that sexualises minors;</li>
          <li>share someone else&apos;s personal information;</li>
          <li>spam, advertise or flood chat;</li>
          <li>
            cheat, for example by using more than one account to rate your own tracks, trading or coordinating ratings, or submitting
            work that isn&apos;t yours;
          </li>
          <li>use bots, scripts or automation to play, rate or scrape Beathoven;</li>
          <li>exploit bugs, probe our systems, get around rate limits or bans, or interfere with the service or other players;</li>
          <li>upload malware or link to harmful, deceptive or illegal sites;</li>
          <li>break the law.</li>
        </LegalList>
        <p>
          Room hosts can kick players, and players can vote to kick someone. A kicked player can&apos;t rejoin that room. If you find
          a security issue, please email us instead of exploiting it.
        </p>
      </LegalSection>

      <LegalSection title="Your music and other content">
        <p>
          <Term>You keep ownership</Term> of the tracks you upload and everything else you post, such as your profile, avatar and chat
          messages.
        </p>
        <p>
          To run Beathoven, you give us a worldwide, non-exclusive, royalty-free licence to host, store, copy, process and stream your
          content, and to display it, only for operating and improving Beathoven. In practice that means:
        </p>
        <LegalList>
          <li>playing your tracks to the people in your room, and letting them replay them later;</li>
          <li>showing your tracks, stats and waveforms on your profile and Top tracks;</li>
          <li>
            letting anyone who visits your profile play the latest version of each of your Top tracks, once the game it was played in
            reached results;
          </li>
          <li>checking files and making fingerprints, hashes, waveforms and format conversions, like removing metadata.</li>
        </LegalList>
        <p>
          This licence ends when your content is deleted, except for copies in backups for a limited time. We won&apos;t sell your music
          or use it in ads.
        </p>
        <p>
          <Term>Only upload what you have the rights to.</Term> You promise that you own your uploads or have permission for everything
          in them, including samples, loops, vocals and beats, and that sharing them on Beathoven doesn&apos;t infringe anyone&apos;s
          copyright or other rights. Premade mode is for your own finished songs, not other artists&apos; music.
        </p>
        <p>
          Other people&apos;s tracks are theirs. You can listen to them in Beathoven, but don&apos;t record, download, reupload or
          distribute them without the producer&apos;s permission.
        </p>
      </LegalSection>

      <LegalSection title="Copyright complaints">
        <p>
          If you believe something on Beathoven infringes your copyright, email <ContactEmail /> with:
        </p>
        <LegalList>
          <li>your name and contact details;</li>
          <li>the work you believe is infringed;</li>
          <li>where the material is on Beathoven, such as the username, room or track;</li>
          <li>a statement that you believe in good faith the use isn&apos;t authorised by the owner, its agent or the law;</li>
          <li>
            a statement, under penalty of perjury, that your notice is accurate and that you&apos;re the owner or authorised to act for
            them;
          </li>
          <li>your physical or electronic signature.</li>
        </LegalList>
        <p>
          We&apos;ll remove material that a valid notice identifies. If your content was removed and you believe that was a mistake,
          you can send us a counter-notice with the same kind of details. We close the accounts of repeat infringers.
        </p>
      </LegalSection>

      <LegalSection title="How we enforce these terms">
        <p>
          We don&apos;t review everything before it goes up, but we can remove any content and limit, suspend or close any account that
          we believe breaks these terms or the law, or puts Beathoven or other players at risk. We may use automated tools to help, such
          as file hashes and audio fingerprints that identify duplicate or previously removed uploads, and we can block a file so it
          can&apos;t be uploaded again. Where it&apos;s practical, we&apos;ll tell you what happened and why.
        </p>
      </LegalSection>

      <LegalSection title="Our stuff">
        <p>
          The Beathoven name, logo, site and software belong to us. These terms don&apos;t give you any rights to them beyond using
          Beathoven as intended. DAW names and logos belong to their owners and don&apos;t mean they endorse Beathoven.
        </p>
        <p>
          Profile links lead to other sites. We check them for known threats, but we don&apos;t control those sites and aren&apos;t
          responsible for them.
        </p>
      </LegalSection>

      <LegalSection title="No warranty">
        <p>
          Beathoven is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the fullest extent the law allows, we make no
          promises that it will be uninterrupted, error-free or secure, or that your uploads, stats or other content will be kept. Keep
          your own copies of your music.
        </p>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <p>
          To the fullest extent the law allows, we aren&apos;t liable for any indirect, incidental, special, consequential or punitive
          damages, or for lost data, profits or opportunities, arising from your use of Beathoven. Our total liability for any claim
          about Beathoven is limited to the greater of the amount you paid us in the past 12 months or US$50. Some places don&apos;t
          allow these limits, so they may not all apply to you.
        </p>
        <p>
          If your content or your breach of these terms leads to a claim against us, you agree to cover our reasonable costs of dealing
          with it, as far as the law allows.
        </p>
      </LegalSection>

      <LegalSection title="Ending things">
        <p>
          You can stop using Beathoven at any time and ask us to delete your account by emailing <ContactEmail />. We may suspend or
          end your access if you break these terms, or stop offering Beathoven altogether. The sections on your content&apos;s licence
          (for backups), copyright, no warranty, limitation of liability and governing law survive.
        </p>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <p>
          We may update these terms. We&apos;ll change the date at the top, and for significant changes we&apos;ll let you know in the
          app before they take effect. If you keep using Beathoven after that, you accept the new terms.
        </p>
      </LegalSection>

      <LegalSection title="Governing law">
        <p>
          These terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict of law rules. This doesn&apos;t take away
          any protections you have under the consumer laws of the country where you live.
        </p>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about these terms: <ContactEmail />.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
