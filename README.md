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
- WYSIWYG markdown editing
- Task lists with checkboxes and drag-to-reorder
- Dedicated to-do list view
- Image and PDF file attachments
- Folders and pinned notes
- Full-text search
- Cloud sync and note sharing via Supabase

Currently supports Windows, macOS, and Web (PWA).

<img width="1507" height="820" alt="Screenshot 2026-02-24 at 12 30 55 AM" src="https://github.com/user-attachments/assets/ad7958de-b2c4-432d-8bb9-fced059df2ce" />


## Setup

**Prerequisites:** [Node.js](https://nodejs.org/), [pnpm](https://pnpm.io/installation), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```sh
git clone https://github.com/alexshoe/matcha.git
cd matcha
pnpm install
```

**Environment variables** — copy the example file and fill in your Supabase project credentials:

```sh
cp .env.example .env
```

Open `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from your [Supabase project settings](https://supabase.com/dashboard).

### Desktop app (Tauri)

```sh
pnpm dev:desktop      # dev mode
pnpm build:desktop    # production build
```

### Web app

```sh
pnpm dev:web          # dev server at http://localhost:3000
pnpm build:web        # production build
```
