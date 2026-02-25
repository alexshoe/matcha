<br />
<div align="center">
  <a href="https://github.com/alexshoe/matcha">
    <img width="158" height="105" alt="matcha_logo_m" src="https://github.com/user-attachments/assets/c3f37e6e-13d6-4ff3-aea7-47064c7a69b9" />
  </a>
  <h3 align="center">matcha</h3>
  <p align="center">
      A lightweight, cross-platform note-taking and to-do list app.
  </p>
</div>

-----

- Rich text editing — headings, bold, italic, lists, blockquotes, tables
- What-you-see-is-what-you-get markdown editing
- Task lists with checkboxes and drag-to-reorder
- Dedicated to-do list view
- Image and PDF file attachments
- Folders and pinned notes
- Full-text search
- Cloud sync and note sharing via Supabase

Currently supports Windows and MacOS -- iOS coming soon.


<img width="1507" height="820" alt="Screenshot 2026-02-24 at 12 30 55 AM" src="https://github.com/user-attachments/assets/ad7958de-b2c4-432d-8bb9-fced059df2ce" />


## Setup

**Prerequisites:** [Node.js](https://nodejs.org/), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
git clone https://github.com/alexshoe/matcha.git
cd matcha
npm install
```

To run in dev mode:

```sh
npm run tauri dev
```

To create a production build:

```sh
npm run tauri build
```
