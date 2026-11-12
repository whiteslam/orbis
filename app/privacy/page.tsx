import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicShell } from '@/components/marketing/public-shell';
import { LEGAL_UPDATED, SITE_NAME, siteUrl, supportEmail } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${SITE_NAME} collects, uses and deletes your data, who processes it, and the rights you have under India’s DPDP Act.`,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage() {
  const email = supportEmail();
  const contact = email ? <a href={`mailto:${email}`}>{email}</a> : <>through the <Link href="/support">support page</Link></>;

  return (
    <PublicShell>
      <div className="mkt-legal-head">
        <h1>Privacy Policy</h1>
        <p className="mkt-legal-updated"><strong>Draft: pending owner review</strong></p>
        <p className="mkt-legal-updated">Last updated {LEGAL_UPDATED}</p>
      </div>

      <div className="mkt-legal-body">
        <p>
          This page explains what {SITE_NAME} collects, who handles it, and what you can do about it. It is written
          for people in India and follows India’s Digital Personal Data Protection Act, 2023 (DPDP Act). It is in plain
          language and is not legal advice.
        </p>
        <p>
          In DPDP terms, the people who run {SITE_NAME} decide why and how your data is used (we are the “data
          fiduciary”), and you are the “data principal”. When this page says “we”, it means them.
        </p>

        <h2>The short version</h2>
        <ul>
          <li>{SITE_NAME} holds only what you type in, upload or connect.</li>
          <li>Nothing is sent to an AI provider until you turn AI on. It is off for every new account.</li>
          <li>Inside the app, each person’s data is visible only to that person.</li>
          <li>We do not sell your data and we do not run ads.</li>
          <li>You can export or delete your data, or turn any connection off, whenever you like.</li>
          <li>{SITE_NAME} is for people aged 18 and over.</li>
        </ul>

        <h2>What we hold</h2>
        <p>Depending on what you use, that can include the following.</p>

        <h3>Your account</h3>
        <ul>
          <li>Your email address and sign-in details. If you use Google sign-in, Google tells us your email address.</li>
          <li>Your settings: time zone, currency, language and region, and which modules you chose. These start as India (Asia/Kolkata, INR, en-IN) until you change them.</li>
          <li>Your role and plan on {SITE_NAME}. These are set by us and you can only read them.</li>
          <li>If you set one, an app PIN that locks {SITE_NAME} on that device.</li>
          <li>Your AI choices: whether AI is on, when you first agreed, and whether the Home brief is on.</li>
          <li>Counts of how much you used some features each day, so that daily limits work.</li>
        </ul>

        <h3>Money</h3>
        <ul>
          <li>Spending and income you add: amount, currency, merchant, category, date, payment method and a note.</li>
          <li>Holdings you enter by hand, and holdings read from Zerodha or Groww if you connect them (read only). We store the connection’s encrypted access details, the holdings, and when they last synced.</li>
          <li>Your income plan, goals and habits.</li>
          <li>AI advice you chose to save, such as workbook advice or portfolio suggestions.</li>
          <li>If you use a spreadsheet for advice, the file is stored briefly so it can be read, then removed. We keep a summary of the advice, not the file.</li>
        </ul>

        <h3>Health</h3>
        <ul>
          <li>Daily step counts. You get these by importing an Apple Health export. The file is read in your browser and only the daily totals are sent to us.</li>
          <li>Health documents you upload (PDF or spreadsheet): the file, a preview, and its text broken into pieces so it can be searched. Adding a document needs AI to be on.</li>
          <li>Health plans you build, including your answers to the questions.</li>
          <li>Your fitness persona, a short note you write about yourself.</li>
        </ul>

        <h3>Journal, notes and routines</h3>
        <ul>
          <li>Journal entries: date, mood, tags and text, with the earlier versions of what you edit.</li>
          <li>Voice notes you record in the journal. The audio is stored in your private storage.</li>
          <li>Notes you save for {SITE_NAME} to remember, and their earlier versions.</li>
          <li>Routines, their schedule and your check-ins.</li>
          <li>Your profile: preferred name, role and “about me”.</li>
          <li>Heads-ups {SITE_NAME} shows you, and which kinds you have turned off.</li>
        </ul>

        <h3>Social</h3>
        <ul>
          <li>Posts you plan or draft: title, caption, hashtags, platforms, dates, and any photo or video you attach.</li>
          <li>If you connect Instagram or Threads (Meta): your account name, an encrypted access token, and the post numbers Meta gives us. {SITE_NAME} publishes only posts you choose to publish.</li>
        </ul>

        <h3>Career</h3>
        <ul>
          <li>Your resume (the file and its text), the career profile made from it, and what you are looking for.</li>
          <li>Jobs {SITE_NAME} finds or you paste, your applications, the tailored resumes and cover notes, interview prep, and offers you enter.</li>
          <li>The record of job-alert emails and employer replies {SITE_NAME} has handled: Gmail message ids and what we took from each one, such as a status change. We do not keep a copy of the email.</li>
        </ul>

        <h3>Ask Orbis and Talk to Orbis</h3>
        <ul>
          <li>We count your questions each day for the daily limit. We do not keep your questions or the answers.</li>
          <li>For each AI request we keep a log line: which feature, which provider and model, whether it worked, how long it took, how many tokens it used, and its cost. It does not hold the text you sent or received.</li>
        </ul>

        <h3>Connections, notifications and location</h3>
        <ul>
          <li>Gmail (and Google Calendar permission) if you connect Google. See “Your connections” below.</li>
          <li>An approximate location (a city and its coordinates) that you choose, used only to show local weather.</li>
          <li>Notification settings and times, a push token for each device you turn notifications on for, and a log of the notifications sent.</li>
        </ul>

        <h3>If you are on the waitlist</h3>
        <p>
          We keep the email address you gave and when you joined. To limit abuse we also count requests per visitor
          using a scrambled version of the network address, never the address itself. Those counts are dropped after
          a day.
        </p>

        <h2>Why we use it, and your consent</h2>
        <p>
          We use your data to run the features you use and to show it back to you. We do not use it for anything
          else. By adding data, or by turning on a connection or AI, you consent to that use. You can withdraw that
          consent at any time (see “Your rights”). Withdrawing does not undo what we did before you withdrew.
        </p>

        <h2>Who handles your data</h2>
        <p>{SITE_NAME} relies on a small set of services, each for one job.</p>
        <ul>
          <li><strong>Vercel</strong> runs the application.</li>
          <li><strong>Supabase</strong> holds your account, your data and your stored files, and signs you in.</li>
          <li><strong>AI providers</strong>, only after you turn AI on: Groq, Google Gemini, Mistral, OpenRouter and Anthropic (Claude). See “How AI uses your data”.</li>
          <li><strong>Sarvam</strong> turns speech into text and text into speech for Talk to Orbis, if voice is set up.</li>
          <li><strong>Google</strong> for Gmail, only if you connect it.</li>
          <li><strong>Zerodha</strong> and <strong>Groww</strong>, only if you connect them.</li>
          <li><strong>Meta</strong> (Instagram and Threads), only if you connect them.</li>
          <li><strong>Job sources</strong> for Career: Himalayas, Remotive, Remote OK, We Work Remotely, Jobspresso, Hacker News, Adzuna, and the hiring pages of companies you add (Greenhouse, Lever, Ashby, Recruitee). {SITE_NAME} reads their public listings. If you send an application through Recruitee, that application goes to the company.</li>
          <li><strong>Open-Meteo</strong> gets your approximate coordinates to give you the weather.</li>
          <li><strong>Alpha Vantage, AMFI, Frankfurter and NewsData</strong> supply prices, exchange rates and headlines. Price lookups name the stock or fund; headlines are the same for everyone.</li>
          <li><strong>Sentry</strong> receives error reports, if error reporting is switched on. We have set it up to send only the error, where in the code it happened and which page it came from. It is set to leave out cookies, user details, request contents and query strings.</li>
        </ul>
        <p>
          Our hosts may also keep their usual technical logs, such as network addresses and times of requests. We do
          not sell your data and we do not run ads.
        </p>
        <p>
          Some of these services run outside India, so your data can be processed outside India when you use the
          features that rely on them.
        </p>

        <h2>How AI uses your data</h2>
        <p>
          AI is off until you turn it on, in <strong>Settings → AI &amp; privacy</strong>. While it is off, nothing is
          sent to any AI provider and {SITE_NAME} uses its own wording. You can turn it off again at any time.
        </p>
        <p>
          When it is on, each feature sends only what it needs, and only when it runs. Settings → AI &amp; privacy
          lists this feature by feature. In short:
        </p>
        <ul>
          <li>The Home brief and daily notification: your first name, spending totals, routines due, step counts, and the weather.</li>
          <li>Ask Orbis and Talk to Orbis: your question, plus your journal, saved notes, spending, routines and steps from the last six months, only for the sources you tick.</li>
          <li>Money advice: a summary of the file you upload, or your holdings’ names, values and mix.</li>
          <li>Health plans: passages from your health documents, your profile, your fitness persona, your step averages and your answers.</li>
          <li>Social drafts: your brief, and your profile if you tick “Use my profile”.</li>
          <li>Career: your resume and profile, what you are looking for, job descriptions, and employer replies found in your Gmail.</li>
        </ul>
        <p>
          For Ask Orbis and Talk to Orbis, a small decision model called Jev (by TypeSafe, reached through OpenRouter
          with zero data retention) first reads your question, and only your question, to decide how much AI the
          question needs.
        </p>
        <p><strong>Which provider gets it.</strong> {SITE_NAME} picks the most capable provider that is available for each request.</p>
        <ul>
          <li>Our settings mark Groq, and Claude (both direct from Anthropic and through OpenRouter, where we ask OpenRouter to use Anthropic only and not to collect data), as providers that do not train on what they receive.</li>
          <li>Our settings mark Google Gemini, Mistral and OpenRouter’s free models as providers that may keep or train on what they receive.</li>
          <li>Today, requests built from your personal data are not limited to the first group. They can go to any provider above.</li>
        </ul>
        <p>
          If a health document search index is switched on for this deployment, the text of a document you add is sent
          to OpenRouter to build that index, using a model that may train on it. Adding a document needs AI to be on.
        </p>
        <p>
          AI can be wrong. Read the <Link href="/terms">terms</Link> on what its output is and is not.
        </p>

        <h2>Who can see your data</h2>
        <p>
          Inside the app, your data is protected by row-level security in the database. Your signed-in session can
          read and change only your own rows. No other person using {SITE_NAME} can see yours.
        </p>
        <p>
          People who run {SITE_NAME} are a different case, and we want to be straight about it. The service needs
          technical access to run: for backups, scheduled jobs such as notifications and job searches, deleting
          accounts, and the few tables people cannot reach themselves. That access skips row-level security. We limit
          it. Every use is reviewed, each query is for one person’s own job, and an automated test fails if new code starts using it without being listed. {SITE_NAME} is not zero-knowledge: your content is not encrypted
          separately for each person, so someone with full access to our servers could read it. Only your connection
          tokens (Gmail, Zerodha, Groww, Instagram and Threads) are stored encrypted.
        </p>
        <p>
          The search index for your health documents (the pieces of text and their search vectors) is stored on the
          server, protected by access rules and not separately encrypted.
        </p>

        <h2>Your connections</h2>
        <ul>
          <li><strong>Gmail.</strong> When you connect Google, {SITE_NAME} asks for read-only access to Gmail and to Google Calendar. On Today it reads the sender, subject, date and short preview of important mail, live, and does not store them. For Career it reads job-alert emails and employer replies.</li>
          <li><strong>Sending from Gmail.</strong> This is off unless you press “Allow sending applications” in Career. Then {SITE_NAME} sends only an application, follow-up or reply that you approved by pressing Send. It never sends on its own.</li>
          <li><strong>Brokers.</strong> Zerodha and Groww are read-only. {SITE_NAME} only reads your holdings. It does not place orders.</li>
          <li><strong>Instagram and Threads.</strong> You give permission to read basic account details and post numbers, and to publish posts you choose to publish.</li>
        </ul>
        <p>
          {SITE_NAME} never edits or deletes anything in Gmail. You can disconnect any connection in Settings, and
          deleting your account disconnects them all.
        </p>

        <h2>Voice</h2>
        <p>
          For Talk to Orbis, your recording is sent to Sarvam to be turned into text, and the answer is sent to Sarvam
          to be spoken. This happens only after AI is on. {SITE_NAME} does not store the recording. Sarvam handles
          it under its own policy. Voice notes you record in the journal are different: they stay in your private
          storage and are not sent to Sarvam or to an AI provider.
        </p>

        <h2>How long we keep it</h2>
        <ul>
          <li>Your data is kept until you delete it or delete your account. We set no other time limit.</li>
          <li>A spreadsheet you upload for advice is removed once it has been read. The same goes for the temporary upload copy of a health document. Removal is best effort: if it fails, the copy stays until you delete your account.</li>
          <li>Talk to Orbis recordings are not stored.</li>
          <li>Counts used for abuse limits are dropped within about a day.</li>
          <li>When you delete your account, we disconnect your connections (and ask Google to revoke the Gmail token), delete your stored files, then delete your account, which removes your rows. Copies in our host’s backups may remain for a while longer. We do not use them.</li>
        </ul>

        <h2>Your rights</h2>
        <p>Under the DPDP Act you can:</p>
        <ul>
          <li><strong>See your data and get a copy.</strong> Use <strong>Settings → Your data → Export my data</strong> for a file with everything {SITE_NAME} holds for you. Stored files are listed in it, and you can save them from where they live in the app. Connection tokens are left out.</li>
          <li><strong>Correct it.</strong> Edit most things directly in the app. If you cannot, contact us {contact}.</li>
          <li><strong>Erase it.</strong> Use <strong>Settings → Your data → Delete account</strong> or the <Link href="/delete-account">delete-account page</Link>. If you cannot sign in, contact us {contact}.</li>
          <li><strong>Withdraw consent.</strong> Turn AI off in Settings → AI &amp; privacy, or disconnect any connection in Settings. Both stop at once.</li>
          <li><strong>Name a nominee.</strong> You can nominate someone to use these rights for you if you die or cannot act. Contact us {contact} to set this up.</li>
          <li><strong>Raise a grievance.</strong> See below.</li>
        </ul>

        <h2>Children</h2>
        <p>
          {SITE_NAME} is for people aged 18 and over. It is not for anyone under 18. The DPDP Act needs a parent’s
          verified consent for a child’s data, and we do not offer that. If you think a child has an account, contact
          us {contact} and we will delete it.
        </p>

        <h2>Coming with the Android app</h2>
        <p>
          We are building an Android app. This part describes how it is meant to work, and it will be updated before
          it launches. Nothing on your phone is read until you turn each source on, one by one. Raw phone data, such
          as notification text, stays on your phone. Only facts taken from it, such as a transaction or a missed call,
          are sent to your account. A private vault, such as Android’s Private Space, is never read. Apps and contacts
          you block are never read or stored. Phone data will go only to AI providers that do not train on it, and
          the stored phone content will be encrypted on the server for each person.
        </p>

        <h2>Contact and grievance officer</h2>
        <p>
          For any privacy question, a request about your data, or a grievance, reach us {contact}. We will answer
          you there. If we cannot sort it out, you can complain to the Data Protection Board of India.
        </p>
      </div>

      <p className="mkt-legal-note">
        This policy describes {SITE_NAME} as available at {siteUrl()}. It may change as the product changes; the date
        above always reflects the latest version.
      </p>
    </PublicShell>
  );
}
