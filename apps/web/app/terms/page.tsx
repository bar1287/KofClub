import Link from 'next/link';

/** House rules every player and club owner accepts by using KofClub. */
export default function TermsPage() {
  return (
    <main className="content">
      <article className="panel stack terms" data-testid="terms">
        <h1>Terms and house rules</h1>
        <p className="muted small">
          KofClub is a social poker platform. These rules apply on the web and in the Telegram app.
        </p>

        <h2>Virtual chips only</h2>
        <ul>
          <li>
            Chips are virtual. They have no monetary value and cannot be bought, sold, cashed out,
            exchanged or redeemed for money, crypto, goods or prizes.
          </li>
          <li>
            Club owners give out chips for free. Nobody may charge money for chips, seats, club
            membership, tournament entries or results.
          </li>
          <li>
            Playing for real money in any form is forbidden, including settling up outside the app
            (cash, bank transfers, payment apps, crypto or anything of value). Clubs that do so are
            closed and their owners banned.
          </li>
        </ul>

        <h2>Telegram Stars</h2>
        <ul>
          <li>
            Where Telegram Stars are offered, they buy only digital extras for the app itself, such
            as a club subscription, visual themes or a tip to the developers.
          </li>
          <li>
            Stars never buy chips, seats, tournament entries, better odds or anything that changes a
            game. Nothing won in a game can be turned into Stars.
          </li>
          <li>
            For help with a purchase, send <span className="mono">/paysupport</span> to our bot.
          </li>
        </ul>

        <h2>Operators</h2>
        <ul>
          <li>
            Anyone can run KofClub under their own Telegram bot as an operator. Each operator&apos;s
            players and clubs form a separate service with these same rules.
          </li>
          <li>
            Operators may not charge players money, run cash games, collect fees or settle results
            in any form. KofClub suspends operators that do, and their bots stop working.
          </li>
          <li>Report an operator that breaks these rules to KofClub&apos;s support.</li>
        </ul>

        <h2>Fair play</h2>
        <ul>
          <li>One person, one account. No bots, collusion, chip dumping or sharing hole cards.</li>
          <li>Be kind in chat. Club staff can remove messages and players.</li>
          <li>You must be old enough to use social gaming apps where you live.</li>
        </ul>

        <p>
          <Link href="/">Back to KofClub</Link>
        </p>
      </article>
    </main>
  );
}
