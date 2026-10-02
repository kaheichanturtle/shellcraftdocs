# Shellcraft Docs

> **a little space for big ideas**
>
> **Live App:** [kaheichan.neocities.org/docs](https://kaheichan.neocities.org/docs/) - **Current Version:** `15.2.1`

**Shellcraft Docs** is a portable, single-file, zero-dependency document editor that saves and exports self-contained, A4-paginated HTML documents. No servers, no accounts, and no subscriptions—just open the file in any browser and write.

---

## Why Shellcraft Docs Exists: A Call to Action for a Universal Editable Document Format

### 1. Bridging the Document Gap Across Every Device
Every phone, tablet, laptop, desktop, and smart TV already ships with a web browser capable of opening an HTML file out of the box. By contrast, proprietary or complex office formats such as `.docx` require specialised software that not every device has installed, and full editing capabilities are frequently locked behind costly subscriptions. Because every Shellcraft document is standard HTML, anyone can open and read it immediately on any device they own.

### 2. Rigid Pages That Never Jump — Doing for Editing What PDF Did for Printing
**PDF** became the universal file format for printing and sharing because its layout is fixed: what you see on one screen is exactly what appears on another. **Shellcraft Docs is an experiment and a call to action for a universal *editable* file format.**

Historically, HTML documents reflowed unpredictably depending on window width, while `.docx` files shifted pagination depending on installed fonts and office suites. Shellcraft Docs locks content into rigid A4 pages (`210mm × 297mm`) and automatically scales the sheet to fit the viewer's screen—so it isn't oversized on a phone or tiny on a television. Pages stay rigid and in place, text never jumps, and printing to PDF (`Ctrl/⌘ + P`) produces an exact 1:1 sheet, while the file itself remains completely editable when reopened in Shellcraft Docs.

### 3. Native to the Age of AI
As we step into the world of AI, large language models are natively fluent in HTML, CSS, and SVG. Generating a richly structured, colour-coded, diagram-illustrated HTML document is effortless for modern AI systems—whereas AI tools still lag behind at directly producing beautifully formatted Word (`.docx`) documents or raw `.pdf` files. 

### 4. Security by Design — The Case for `.hdoc` (Scriptless HTML Documents)
A common concern with sharing files is malware. Traditional Word documents (`.docx` / macro-enabled files) and `.pdf` documents have a long history of carrying embedded scripts and exploit payloads. Meanwhile, modern web browsers have spent decades hardening their rendering engines and sandboxes against attacks.

If this approach gains wider adoption—potentially under a dedicated file extension such as **`.hdoc` (HTML Document)**—standardising on **scriptless HTML** (pure declarative HTML, CSS, and embedded images/SVGs with **no embedded JavaScript**) creates a document format that is far less likely to harbour viruses than legacy office or PDF files, while remaining universally portable across every operating system.

> ***"We built the container; now it’s time to build the document that lives in it."***

---

## Key Features

- **Single-File, Zero-Dependency Architecture:** The entire application runs from a single `.html` file offline or online, with local-first persistence via `localStorage` or high-capacity **IndexedDB** (with automatic backup before migration).
- **Rigid A4 Pagination & Auto-Fit Screen Scaling:** Real-time A4 sheet pagination in the editor and automatic viewport scaling in exported HTML files so pages fit naturally on phones, tablets, laptops, desktops, and TVs without reflowing text.
- **6-Level Semantic Highlight Hierarchy:**
  - **Purple (`H1`)** — Document / module titles
  - **Blue (`H2`)** — Major subtopics
  - **Green (`H3`)** — Sections & concepts
  - **Yellow (`H4` & Level-1 bullets)** — Sub-sections & primary bullet keywords
  - **Red (Level-2 bullets)** — Secondary nested bullet keywords
  - **Orange (Level-3+ bullets)** — Examples, evidence & tertiary details
  - All highlight colours automatically compute high-contrast text colours (`WCAG` luminance) and are fully customisable in **Settings → Highlight colours**.
- **Cover Pages & Auto-Updating Table of Contents:** Rigid, print-ready A4 cover pages with customisable badge colours (with automatic contrast text colour) and one-click Table of Contents generation.
- **Rich Formatting & Blocks:**
  - Font size (`pt`), Font colour, Bold, Italic, Underline, Strikethrough, and Text alignment (Left, Middle, Right)
  - Nested bullet lists, numbered lists, and interactive checkbox lists
  - Star callout boxes (`.star-callout`), syntax-friendly `<pre><code>` blocks, customisable tables, horizontal rules, and inline SVG diagrams / images with a size slider and alignment controls
- **Split-Screen Editing:** Drag any document from the sidebar to edit two documents side by side.
- **AI Study-Notes Workflow:** Built-in prompt generator for LLMs plus automatic import normalisation that converts AI-generated HTML notes into Shellcraft Docs's A4 layout and TOC style.
- **Optional AES-256-GCM Encryption:** Lock the entire app or individual documents with `PBKDF2-SHA-256` (up to 5,000,000 iterations) and `AES-256-GCM`, including password-protected HTML export.

---

## Getting Started

1. **Use Online:** Open [kaheichan.neocities.org/docs](https://kaheichan.neocities.org/docs/) in any modern browser.
2. **Run Locally / Offline:** Download the latest `Shellcraft Docs` HTML file from this repository and double-click it to open in Chrome, Safari, Edge, or Firefox.
3. **Import Existing Notes:** Click **Import** (or drag and drop any `.html`, `.md` or `.txt` file onto the window) to open and edit it immediately.
4. **Export & Share:**
   - Click **Export** to save a self-contained, scriptless `.html` file with rigid A4 pages that automatically resize to fit any device screen.
   - Click **Print / PDF** (`Ctrl/⌘ + P`) to print or save an exact A4 PDF.

---

## Contributing & Open Source

Shellcraft Docs is open source and welcomes ideas, bug reports, and pull requests at [github.com/kaheichanturtle/shellcraftdocs](https://github.com/kaheichanturtle/shellcraftdocs).
