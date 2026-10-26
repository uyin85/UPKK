# UPKK Pro

App latihan soalan objektif UPKK (A, B, C, D) untuk murid KAFA dan SRA Selangor. Soalan dijana dan disemak oleh pasukan agen AI, kemudian **diluluskan oleh ustaz/ustazah** sebelum dipaparkan kepada murid.

Stack: Cloudflare Workers + Workflows + D1 + R2 + Vectorize + Workers AI, Gemini Pro, Hermes 4 di Modal, pelayan MCP, GitHub Actions.

## Senibina

```
                         ┌──────────── Cloudflare Worker "upkk-pro" ─────────────┐
 PWA murid  ── /api ────▶│ latihan adaptif · mock exam · skor kesediaan · lesen   │──▶ D1
 Panel ustaz ─ /admin ──▶│ barisan semakan · jana · topik · sumber · lesen        │
 Claude/Hermes ─ /mcp ──▶│ list_topics · weak_topics · generate · submit · ...    │
                         └───────────────┬────────────────────────────────────────┘
                                         ▼ Workflow "upkk-generate" (cron 2:15 pagi + manual)
   1 Perancang ─▶ 2 Penjana (Gemini) ─▶ untuk setiap soalan:
      3 Struktur ─▶ 4 Bahasa/Jawi/Arab ─▶ ┌ 5 Syariah (Gemini)
                                          ├ 6 Pengkritik item (Gemini)
                                          ├ 7 Penyelesai buta: Gemini + Hermes@Modal
                                          └ 8 Keaslian (bge-m3 + Vectorize)
      ─▶ 9 Pengimbang A/B/C/D ─▶ 10 Hakim ─▶ status "pending" ─▶ USTAZ lulus ─▶ LIVE
   Sentinel malam: soalan LIVE yang dilapor ≥3 kali atau kadar betul <15% dikembalikan ke semakan.
   Catatan ustaz semasa menolak menjadi "pengajaran" untuk penjana pada kelompok seterusnya.
```

| Agen | Fail | Tugas |
|---|---|---|
| Perancang | `src/agents/planner.js` | Pilih topik paling perlu (jurang bank + topik murid lemah), campuran aras, sasaran huruf jawapan, pengajaran ustaz |
| Penjana | `src/agents/generator.js` | Gemini menjana soalan asli berdasarkan petikan sumber (RAG Vectorize) |
| Struktur | `src/agents/structure.js` | 4 pilihan unik, tiada "semua di atas", petunjuk panjang, huraian |
| Bahasa/Jawi/Arab | `src/agents/reviewers.js` | Betulkan ejaan BM, Jawi (PUEJ DBP) dan baris Arab tanpa ubah makna |
| Syariah | `src/agents/reviewers.js` | Ketepatan fakta, skema betul, tiada dua jawapan betul, risiko khilaf |
| Pengkritik item | `src/agents/reviewers.js` | Kualiti distraktor, kejelasan, kesesuaian umur, padanan aras |
| Penyelesai buta | `src/agents/solver.js` | Gemini dan Hermes menjawab tanpa skema; tidak setuju = tolak/tanda |
| Keaslian | `src/agents/originality.js` | Tolak duplikasi bank (≥0.95) dan soalan yang mirip kertas lepas (≥0.90) |
| Pengimbang | `src/agents/balancer.js` | Taburan jawapan A/B/C/D sekata |
| Hakim | `src/agents/pipeline.js` | Gabung keputusan, skor QA, simpan ke barisan semakan |

## Persediaan tanpa terminal (guna browser sahaja)

Tambah secret ini di GitHub → Settings → Secrets and variables → Actions → New repository secret, kemudian buka tab Actions → "Deploy UPKK Pro" → Run workflow. Workflow akan cipta indeks Vectorize, kemas kini D1, set secret Worker dan deploy.

| Secret | Dari mana |
|---|---|
| `CLOUDFLARE_API_TOKEN` | dash.cloudflare.com → ikon profil → My Profile → API Tokens → Create Token → template "Edit Cloudflare Workers", tambah Account › D1 › Edit dan Account › Vectorize › Edit |
| `CLOUDFLARE_ACCOUNT_ID` | dash.cloudflare.com → Workers & Pages → panel kanan "Account ID" |
| `GEMINI_API_KEY` | aistudio.google.com/apikey → Create API key |
| `ADMIN_TOKEN` | Rentetan rawak panjang pilihan anda (kata laluan panel ustaz) |
| `MCP_TOKEN` | Rentetan rawak panjang lain (untuk agen MCP) |
| `HERMES_URL`, `HERMES_API_KEY`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET` | Pilihan — untuk penyelesai buta kedua di Modal |

## Persediaan dengan terminal (alternatif)

```bash
npm install
npx wrangler login

# 1. Sumber Cloudflare
npx wrangler d1 create upkk            # salin database_id ke wrangler.toml
npx wrangler r2 bucket create upkk-sources
npm run vectorize:create               # dua indeks 1024 dimensi (bge-m3)

# 2. Skema + silibus + soalan contoh
npm run db:init

# 3. Rahsia
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put ADMIN_TOKEN    # rentetan panjang rawak
npx wrangler secret put MCP_TOKEN      # rentetan panjang rawak lain

# 4. Hermes di Modal (pilihan tetapi disyorkan)
pip install modal && modal setup
modal secret create upkk-hermes HERMES_API_KEY=<rentetan-rawak>
modal deploy modal/hermes_server.py
npx wrangler secret put HERMES_URL     # URL ...modal.run yang dipaparkan
npx wrangler secret put HERMES_API_KEY # kunci yang sama

# 5. Deploy
npm run deploy
```

**GitHub Actions:** tambah secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`. Setiap push ke `main` akan kemas kini skema D1, silibus dan deploy Worker.

**Ujian tempatan:** salin `.dev.vars.example` ke `.dev.vars` dan tetapkan `SHOW_PENDING=true` supaya soalan contoh boleh dicuba sebelum diluluskan. AI dan Vectorize hanya berfungsi dalam mod remote.

## Aliran kerja harian

1. **Masukkan sumber** (Panel → Sumber): nota guru atau buku teks yang anda ada hak untuk guna. Lebih banyak sumber = soalan lebih tepat. Kertas lepas dimasukkan sebagai "penanda keaslian" sahaja.
2. **Sahkan topik** (Panel → Topik): padankan `data/syllabus.json` dengan DSKP KAFA 2.0 dan tandakan "disahkan".
3. **Agen menjana** setiap malam (8 soalan, ubah `DAILY_GEN_COUNT`) atau manual melalui Panel → Jana soalan.
4. **Ustaz menyemak** di `/admin/`: edit terus, lulus, atau tolak dengan catatan.
5. **Jual kod Pro** (Panel → Lesen). Satu kod terikat kepada satu peranti.

## Sambung agen melalui MCP

Endpoint: `https://<worker>/mcp`, header `Authorization: Bearer <MCP_TOKEN>`.

```bash
# Claude Code
claude mcp add --transport http upkk https://<worker>/mcp --header "Authorization: Bearer <MCP_TOKEN>"
```

Hermes Agent: tambah pelayan MCP HTTP yang sama dalam konfigurasi Hermes dengan header Authorization.

Alat: `list_topics`, `bank_stats`, `weak_topics`, `search_questions`, `get_question`, `generate_questions`, `submit_question`, `batch_status`, `review_question`. Agen boleh menolak soalan tetapi **tidak boleh meluluskan** kecuali `MCP_CAN_APPROVE=true`.

## Wajib disahkan sebelum lancar

- [ ] `data/syllabus.json`: semua topik masih **draf**. Padankan dengan DSKP / buku teks KAFA 2.0 rasmi.
- [ ] `data/format.json` → `mock_exam.items`: bilangan item objektif sebenar setiap kertas UPKK belum disahkan (jadual format JAKIM dalam bentuk imej).
- [ ] `readiness_bands`: sempadan gred ialah anggaran app, bukan sempadan rasmi JAKIM. Jangan iklankan sebagai "confirm A".
- [ ] Topik khusus SRA Selangor (Tauhid, Fiqh, Akhlak, Tarikh) ditambah dengan `stream=SRA` selepas silibus JAIS diperoleh.
- [ ] 19 soalan contoh dalam `data/seed_questions.json` perlu disemak ustaz.
- [ ] Jangan muat naik buku teks atau kertas soalan JAKIM tanpa kebenaran. Soalan dalam app mesti asli.

## Struktur fail

```
data/        format.json, syllabus.json, seed_questions.json
src/         index.js (router), workflow.js, mcp.js, ingest.js, api/, agents/, lib/
public/      PWA murid (index.html, app.js, style.css, sw.js) + admin/
modal/       hermes_server.py (vLLM, API serasi OpenAI)
scripts/     build-seed.mjs
schema.sql   skema D1
```
