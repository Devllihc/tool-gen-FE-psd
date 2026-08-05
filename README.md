# PTS Slicer — PSD → React section generator

Cắt ảnh từ Photoshop và sinh khung code React cho từng section, **trước khi ghép API** —
tối ưu thời gian dựng UI từ design.

Tool gồm **2 phần**:

| Phần | Ở đâu | Vai trò |
|---|---|---|
| **A. Plugin Photoshop** (`pts-plugin/`) | Cài 1 lần vào Photoshop, dùng chung mọi dự án | Đọc cây layer → phân loại tĩnh/động → cắt ảnh phẳng vào `public/images/` → ghi `design-spec.json` |
| **B. Project files** (`project-files/`) | Copy vào **mỗi dự án React đích** | `/gen-section` (slash command Claude Code) đọc spec + preview + style dự án → sinh `index.tsx` + `Style.module.scss` |

```
plugin-pts/
├── README.md              ← file này
├── pts-plugin/            ← Phần A: plugin UXP (load vào Photoshop)
└── project-files/         ← Phần B: copy vào repo React đích
    ├── .claude/commands/{gen-section.md, gen-plan.md}
    ├── tools/gen-from-psd/{index.js, plan.js, planFallback.js}
    └── .pts-config.example.json   → đổi tên thành .pts-config.json trong dự án
```

---

## Cài đặt

### A. Plugin Photoshop (`pts-plugin/`)

**Cách 1 — dev / nội bộ (nhanh):** Adobe UXP Developer Tool (UDT) → **Add Plugin** → chọn
`pts-plugin/manifest.json` → **Load**. Sửa code plugin xong bấm **Reload** trong UDT.

**Cách 2 — đóng gói cho designer (`.ccx`):** UDT → chọn plugin → **⋯ → Package** → xuất file
`.ccx` → gửi teammate → double-click cài thẳng vào Photoshop (không cần UDT).

> Đổi dự án đích: chỉ cần bấm **Browse** trong panel chọn thư mục repo khác — **không** phải load lại plugin.

### B. Đưa vào một dự án React

Copy nội dung `project-files/` vào **gốc repo đích**, rồi đổi tên config:

```bash
cp -r project-files/.claude       <repo>/.claude
cp -r project-files/tools          <repo>/tools
cp    project-files/.pts-config.example.json  <repo>/.pts-config.json
# thêm script vào package.json của repo đích:
#   "gen-section": "bun tools/gen-from-psd"
```

Mở `.pts-config.json` và trỏ `styleExemplar` tới **1 section mẫu có sẵn** của repo đó
(codegen sẽ bắt chước style file này). Nếu chưa có section nào, để trống — code vẫn sinh
đúng cấu trúc, chỉ kém idiomatic hơn.

---

## Quy trình dùng (1 phiên Photoshop + 1 lệnh)

### Bước 1 — Photoshop
1. Mở PSD, **chọn 1 group/frame** là gốc section trong bảng Layers.
2. Panel PTS: **Browse** → chọn thư mục gốc repo đích. (Tùy chọn) đặt tên section.
3. **🔍 Analyze structure** → đọc cây layer, tự phân loại tĩnh/động, xuất `preview.png` +
   `design-spec.json` vào `.pts-cache/<slug>/`, hiện **review cards**.
4. **Review**: chỉnh `subRole` (Static / Dynamic / Per-item) + `apiHint` cho node nào cần,
   tick **✓ Reviewed**. (Node `needsReview` bị lọc hiện để bạn quyết.)
5. **✂️ Cut** → cắt ảnh phẳng vào `public/images/` + ghi `design-spec.json`.

### Bước 2 — Claude Code (trong repo đích)
```
/gen-section <slug>
```
Chạy ngay trong phiên Claude Code, thấy từng bước: đọc spec + `preview.png` + `styleExemplar`
+ `CLAUDE.md` → sinh `src/pages/<Section>/index.tsx` + `Style.module.scss` với **demo data**
(seam để `/implement-api` thay bằng API thật sau), rồi chạy `generate-css`.

> Không dùng Claude Code interactive được thì: `bun run gen-section <slug>` (delegate về cùng
> command, chạy `claude -p`, không tương tác).

### (Tùy chọn) AI phân loại lại trước khi cắt
```
bun run gen-section --plan <slug>
```
`tools/gen-from-psd/plan.js` (trong repo đích) chỉ là delegator — spawn `claude -p` để chạy
đúng rule trong **`.claude/commands/gen-plan.md`** (nguồn chân lý duy nhất cho bước này,
giống hệt cách `index.js`/`gen-section.md` phối hợp), rồi ghi đè `plan.json`. Quay lại panel
bấm **🔄 Reload** để nạp. Không có `claude` trên PATH, hoặc AI chạy lỗi → fallback all-static.

> Muốn xem/steer từng bước thay vì chạy non-interactive: mở phiên Claude Code trong repo
> đích rồi gõ `/gen-plan <slug>` trực tiếp.

---

## Convention PSD (QUAN TRỌNG — quyết định chất lượng output)

Tool chỉ tốt bằng file PSD đầu vào. Theo các quy ước sau để "một lần chạy ra ngon":

**Markers** (đặt trong tên layer, ưu tiên hơn mọi suy đoán tự động):

| Marker | Tác dụng |
|---|---|
| `[list]` | Ép group thành list (map component) |
| `[cmp]` | Ép group thành component tách file riêng |
| `[img]` | Ép group/layer thành 1 ảnh asset |
| `[bind:tên]` | Ép thành dynamic (image/text), `apiHint = tên` |
| `[row]` / `[col]` | Ép layout flex ngang / dọc |

**Quy tắc vàng:**
- **Đừng baked dữ liệu động vào ảnh.** Số/giá/counter/điểm ("99", "180.000", "0/8") và text
  đổi theo user → để **layer text sống** (đừng cho vào ảnh), hoặc mark `[bind:...]`.
- **Nút tương tác = mỗi nút 1 group riêng.** Đừng gộp cả cụm (vd SÚT + CẬP NHẬT + LƯỢT CHƠI)
  thành một ảnh — tool chỉ ra được 1 ảnh chết.
- **List:** cụm **≥ 4** group giống cấu trúc mới được nhận là list. **Giữ thứ tự layer con
  nhất quán** giữa các instance (vd luôn `[ảnh, tên, nút]`) — sai thứ tự sẽ ghép/cắt nhầm.
- **Ảnh khác nhau từng instance:** nếu là **design cố định** (vd 5 khung theo đội) → chọn
  **Per-item** ở review (cắt hết N ảnh). Nếu là **ảnh do API cấp** → để **Dynamic** (cắt 1 demo).
- **Frame/nền/decor** → sẽ thành `background`; **ảnh nội dung** → thành `<img>`. Cứ đặt tự nhiên,
  tool + preview tự phân biệt.

---

## `.pts-config.json` (per-project, gốc repo đích)

```json
{
  "varyingImagePolicy": "api-slot",
  "styleExemplar": "src/pages/Section3"
}
```
- `varyingImagePolicy`: ảnh biến thiên trong list mặc định xử thế nào —
  `api-slot` (cắt **1 demo**, coi là slot API) hoặc `fixed-all` (cắt **hết N** ảnh baked).
  Vẫn override được từng node ở review (Per-item/Dynamic). Không có file → mặc định `api-slot`.
- `styleExemplar`: đường dẫn 1 section mẫu của repo để `/gen-section` bắt chước style 1:1.

---

## Cấu trúc plugin (`pts-plugin/`)

| File | Vai trò |
|---|---|
| `manifest.json`, `index.html`, `style.css` | Vỏ panel UXP (kích thước panel, UI, style) |
| `main.js` | Điều phối: phân tích, review UI, cắt, stamping filename |
| `classifyList.js` | Thuần — "gom cái giống, phơi cái khác" + policy (testable ngoài Photoshop) |
| `planCutJobs.js` | Thuần — chọn job cắt + `validatePlan` |
| `textUtils.js` | Thuần — `deburr`/`toPascal`/`toSlug`/`fileSafe` |

Ba file thuần verify được bằng `node -e` không cần Photoshop; `main.js` là UXP-only.

---

## Troubleshooting

- **Panel quá hẹp / kéo không rộng ra** → chỉnh `minimumSize.width` trong `pts-plugin/manifest.json`
  (UXP nhớ kích thước panel theo workspace nên sửa `preferred*` + Reload **không** đổi; chỉ
  `minimumSize` mới ép panel đã lưu rộng ra — hoặc Remove+Add lại plugin / reset workspace).
- **Nút ✂️ Cut bị khoá** → còn node `needsReview` chưa tick "Reviewed" (hoặc tick "Skip warnings").
- **Ảnh item khác nhau nhưng chỉ ra 1 ảnh** → set node đó thành **Per-item** ở review (rồi Cut lại).
- **`generate-css` lỗi** → chạy tay `bun run generate-css` trong repo đích; kiểm tên ảnh đúng BEM.
- **`.pts-cache/` + ảnh cắt** nên gitignore ở repo đích (làm việc tạm).
