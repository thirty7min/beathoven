# Changelog

Notable changes to Beathoven. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cookie-free page view analytics, noted in the Privacy Policy.
- Emoji shortcodes in chat: type `:sob:` to get 😭, or type `:` and two letters to pick from suggestions.
- Hosts can make another player the host from the player menu in the lobby.

### Changed

- Chat stays scrolled to the newest message when you're at the bottom, and shows a "New messages" button when you've scrolled up.
- Guests now pick a display name, and get a random username automatically.
- Closing the tab or the browser takes you out of the room within a few seconds, in the lobby and mid-game. Refreshing keeps your seat.
- If you leave during the upload phase and come back before it ends, you get your seat and your upload back. After that you rejoin as a spectator.
- The host is always listed first, with the previous host right below.
- Players who go quiet are moved out of the lobby after 90 seconds, and out of the room at the end of a game if they were gone for all of it.

## [0.1.0] - 2026-10-18

### Added

- Multiplayer beat battles: create or join a lobby, chat, ready up, and the game starts once everyone is ready.
- Creative mode, where everyone makes a beat from a random prompt, and Premade mode, where everyone uploads a finished track within 3 minutes.
- Upload your track, trim it to the part you want played, and preview it before the deadline.
- Synced listening: every track plays for everyone at the same time, and your rating dial saves your vote as you listen.
- Vote to skip a track once most players agree.
- A review round after listening, with hover previews and click-to-seek.
- Results with total points per track and previews of every entry.
- Room settings for game mode, produce time, listen time, max players, genre, public or private, and hidden or shown producer names.
- Spectator mode: join a game in progress or a full lobby to watch, then take a seat when one opens up.
- Hosts can kick players, and players can vote to kick.
- Profiles with an avatar, bio, DAW badges, a profile link and playable top tracks.
- A leaderboard.
- Play as a guest or sign in with Google, then pick a display name and username.
- Stay in your lobby while you browse the site, with a button in the header to jump back in.
- An audio visualizer while tracks play, and flames on high ratings.
- Loading placeholders across the site.
- Terms of Service and Privacy Policy.

### Changed

- Quick match and Classic mode are paused while we playtest.

[Unreleased]: https://github.com/thirty7min/beathoven/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/thirty7min/beathoven/releases/tag/v0.1.0
