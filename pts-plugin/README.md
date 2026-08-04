# PTS Plugin — PSD → React section generator

Cắt ảnh từ Photoshop và sinh khung code React cho từng section, tối ưu thời gian dựng UI từ design trước khi ghép API.

Plugin này (panel UXP) **project-independent** — nó sống ở một chỗ trung tâm, bạn chọn thư mục dự án đích lúc chạy bằng nút **Browse**. Phần script `tools/gen-from-psd/` (`plan.js`, `index.js`, `planFallback.js`) nằm **trong từng repo dự án đích** và chạy từ `process.cwd()` = repo đó.

---

## Workflow rút gọn (mặc định) — 1 phiên Photoshop + 1 lệnh terminal

```
┌─ Photoshop (1 phiên) ─────────────────────────┐   ┌─ Terminal ───────────────┐
│ 🔍 Phân tích cấu trúc                           │   │ bun run gen-section      │
│   → trích cây layer + phân loại tĩnh/động       │──▶│   .pts-cache/<slug>/      │
│   → xuất preview + ghi raw-tree.json/plan.json  │   │   design-spec.json        │
│ (review cards hiện NGAY)                         │   │                          │
│ ✅ duyệt node cần review                         │   │ → Claude sinh index.tsx / │
│ ✂️ Xác nhận & Cắt ảnh                            │   │   components / Style.scss │
│   → cắt phẳng vào public/images/                │   │ → tự chạy generate-css    │
│   → ghi design-spec.json                        │   │                          │
└─────────────────────────────────────────────────┘   └──────────────────────────┘
```

**Vì sao gộp được:** việc phân loại tĩnh/động (`classifyList.js`) chạy **ngay lúc Phân tích**, nên `plan.json` sẵn sàng liền — không còn bước terminal bắt buộc ở giữa. Phân tích → review → cắt gói gọn trong **một** phiên panel; chỉ còn **một** lệnh `bun` cuối để sinh code.

### Bước 1 — Photoshop (panel)

1. Mở PSD, chọn **1 group/frame** trong bảng Layers.
2. Panel: **Browse** → chọn thư mục gốc repo dự án đích. Đặt tên section (tùy chọn; mặc định lấy từ tên group).
3. Bấm **🔍 Phân tích cấu trúc**. Panel sẽ:
   - Đọc cây layer, tự tính `subRole` cho mọi asset/text và mọi phần tử con của list.
   - Xuất `preview.png` + ghi `raw-tree.json` **và** `plan.json` vào `.pts-cache/<slug>/`.
   - **Hiện luôn review cards.**
4. Duyệt: node nào `needsReview` (tool không chắc — vd bệ đổi màu theo state) sẽ được lọc hiện. Chỉnh dropdown `subRole`/`apiHint` nếu cần, tick **✓ Đã duyệt**. (Bật/tắt "Chỉ hiện node cần review" để xem tất cả.)
5. Bấm **✂️ Xác nhận & Cắt ảnh** (khoá đến khi hết node chưa duyệt, hoặc tick "Bỏ qua cảnh báo, cắt luôn"). Panel cắt ảnh phẳng vào `public/images/` và ghi `design-spec.json`.

### Bước 2 — Terminal (trong repo dự án đích)

```bash
bun run gen-section .pts-cache/<slug>/design-spec.json
```

`tools/gen-from-psd/index.js` (trong repo đích) chỉ là delegator — nó tìm `design-spec.json`, spawn `claude -p` để chạy đúng rule trong **`.claude/commands/gen-section.md`** (nguồn chân lý duy nhất cho bước này). Command đọc `design-spec.json` + `CLAUDE.md` của repo → sinh `src/pages/<Section>/` (index.tsx, components/, Style.module.scss), rồi tự chạy `bun run generate-css`.

> Muốn xem/steer từng bước thay vì chạy non-interactive: mở phiên Claude Code trong repo đích rồi gõ `/gen-section <slug>` trực tiếp.

---

## Bước tùy chọn — nhờ AI phân loại lại (`--plan` / `/gen-plan`)

Chỉ chạy khi muốn AI (Claude) **đặt tên `apiHint` đẹp** hoặc **gỡ các node `needsReview`** giúp trước khi duyệt tay:

```bash
bun run gen-section --plan <slug>
```

`tools/gen-from-psd/plan.js` (trong repo đích) cũng chỉ là delegator, giống hệt `index.js` ở trên — nó đọc `raw-tree.json` + `preview.png`, spawn `claude -p` để chạy đúng rule trong **`.claude/commands/gen-plan.md`** (nguồn chân lý duy nhất cho bước này, y như `/gen-section`), rồi ghi đè `plan.json` bằng bản đã tinh chỉnh. Sau đó quay lại panel bấm **🔄 Tải lại** để nạp bản mới. Nếu không có `claude` trên PATH, hoặc AI chạy lỗi/không ghi được `plan.json` → fallback giữ nguyên phân loại cấu trúc (không đổi gì).

> Muốn xem/steer từng bước thay vì chạy non-interactive: mở phiên Claude Code trong repo đích rồi gõ `/gen-plan <slug>` trực tiếp.

> Đây **không bắt buộc**: phân loại cấu trúc lúc Phân tích thường đã đủ dùng, và codegen (bước 2) cũng tự suy tên prop khi sinh code. `/gen-plan` là bước DUY NHẤT trong cả pipeline thật sự "nhìn" ảnh preview trước khi cắt — `classifyList.js` lúc Phân tích chỉ so cấu trúc (tên/size/text), không hề xem ảnh.

---

## Cấu hình per-project — `.pts-config.json`

Đặt ở gốc repo đích. Quyết định cách xử lý **ảnh biến thiên theo từng instance của list**:

```json
{
	"varyingImagePolicy": "api-slot",
	"styleExemplar": "src/pages/Section3"
}
```

`varyingImagePolicy` — xử lý ảnh biến thiên theo từng instance của list:

- `api-slot` (mặc định): ảnh biến thiên = **slot data API** → cắt **1 ảnh demo**, runtime API thay. Đúng cho landing page data-driven ("dựng form trước, ghép API sau").
- `fixed-all`: ảnh mỗi instance một khác = **asset thiết kế cố định** → cắt **hết N ảnh** (`<slug>__<name>_1.png`…`_N.png`). Dùng khi ảnh là baked design (vd 5 khung thành theo đội).

Không có file → mặc định `api-slot` (lean-dynamic, không cắt dư ảnh baked).

`styleExemplar` — đường dẫn 1 section thật trong repo (mặc định `src/pages/Section3`) mà bước codegen (`gen-section`) **nhét nguyên văn vào prompt làm khuôn mẫu** để Claude bắt chước 1:1 (map inline, vị trí bằng class `--N`, `getParam` title, bg-vs-img, fallback demo…). Đổi section mẫu chỉ cần sửa key này.

---

## Phân loại (subRole) — tool tự quyết thế nào

Với node **asset/text** đơn lẻ và với mỗi **phần tử con của list**:

| subRole | Nghĩa | Cắt ảnh |
|---|---|---|
| `static-asset` | Ảnh cố định, giống nhau mọi nơi | 1 ảnh dùng chung |
| `dynamic-image` | Slot ảnh do API cấp | 1 ảnh demo (fallback) |
| `static-per-instance` | Ảnh cố định nhưng **mỗi instance một khác** | cắt **hết N** ảnh, render theo index |
| `text` | Text cố định | (không cắt) |
| `dynamic-text` | Text theo data (số, tên…) | (không cắt) |

**Cơ chế cho list ("gom cái giống, phơi cái khác"):**
- Chọn instance có cấu trúc phổ biến nhất (modal) làm template — instance state-variant bất thường (vd mốc "đã nhận" có thêm ruy-băng) không làm hỏng template.
- Phần **giống hệt** giữa các instance → `static-asset` (cắt 1 lần).
- Phần **khác nhau**: ảnh → `static-per-instance` (policy `fixed-all`) hoặc `dynamic-image` (`api-slot`); text → `dynamic-text`; group đổi theo state (không có text) → `static-asset` + `needsReview`.

**Ngưỡng list:** một cụm chỉ được coi là list (→ 1 component `.map()`) khi có **≥ 4** group con giống cấu trúc. Cụm 2–3 phần tử khác chức năng (vd 3 nút riêng) **không** bị gom thành list — tránh lạm dụng chia component.

**Vị trí từng phần tử trong instance (`boundsOverride`):** cây chỉ lưu **1 bộ `bounds`** dùng chung cho mọi instance (lấy từ instance mẫu). Đúng khi các instance giống nhau hình học (chỉ khác vị trí ngoài, vd 8 mốc thành tích cùng size). Nếu PSD vẽ khác nhau thật (vd khung thành theo phối cảnh: khung ngoài to hơn khung trong) → node đó có thêm `boundsOverride: { "<instanceIndex 0-based>": {x,y,w,h} }`, chỉ ghi cho instance nào lệch quá 3px so với mẫu — codegen (`/gen-section`) đọc field này để tạo override riêng cho đúng instance đó, thay vì dùng chung 1 bộ số sai cho tất cả.

> **Không có field cho rotation.** Photoshop không giữ lại góc xoay sau khi Free Transform trên layer raster được commit (pixel đã resample), nên plugin không có gì để đọc/trích xuất. Instance nào bị nghiêng thật (vd nhãn tên ở 2 khung ngoài cùng) phải để `/gen-section` tự nhìn preview và thêm `transform: rotate()` bằng mắt — đúng cách mọi chi tiết trực quan khác trong pipeline này vẫn được xử lý.

---

## Markers (tùy chọn, ground truth)

Đặt trong tên layer, ưu tiên hơn mọi suy đoán tự động:

| Marker | Tác dụng |
|---|---|
| `[list]` | Ép group thành list |
| `[cmp]` | Ép group thành component |
| `[img]` | Ép thành asset |
| `[row]` / `[col]` | Ép layout flex ngang/dọc |
| `[bind:tênField]` | Ép thành dynamic (image/text), `apiHint = tênField` |

---

## Artifact & vị trí file

- `.pts-cache/<slug>/` — làm việc tạm, **gitignore**: `preview.png`, `raw-tree.json`, `plan.json`, `design-spec.json`.
- `public/images/` — ảnh cắt, **phẳng** (không thư mục con), tên BEM (`<slug>__<name>.png`, `--demo`, `_1..N`) để `generate-css` đọc được.
- `src/pages/<Section>/` — code sinh ra.

---

## Cấu trúc plugin

| File | Vai trò |
|---|---|
| `manifest.json`, `index.html`, `style.css` | Vỏ panel UXP |
| `main.js` | Điều phối: phân tích, review UI, cắt, stamping. Gọi `classifyList`/`planCutJobs`/`textUtils` |
| `classifyList.js` | Thuần — logic "gom cái giống, phơi cái khác" + policy (testable ngoài Photoshop) |
| `planCutJobs.js` | Thuần — chọn job cắt + `validatePlan` |
| `textUtils.js` | Thuần — `deburr`/`toPascal`/`toSlug`/`fileSafe` |

Ba file thuần (`classifyList`, `planCutJobs`, `textUtils`) verify được bằng `bun -e` không cần Photoshop; `main.js` là UXP-only, chỉ `node --check` được.

---

## Nạp / reload plugin

Adobe UXP Developer Tool → **Add Plugin** → chọn `manifest.json` này → **Load**. Sau khi sửa `main.js`/`*.js`/`index.html` → bấm **Reload** trong UDT. Đổi dự án đích chỉ cần **Browse** lại thư mục khác, không cần load lại plugin.

---

## Troubleshooting

- **"Chưa có plan.json"** khi bấm 🔄 Tải lại → bấm 🔍 Phân tích cấu trúc trước.
- **Nút ✂️ Cắt bị khoá** → còn node `needsReview` chưa tick "✓ Đã duyệt" (hoặc tick "Bỏ qua cảnh báo, cắt luôn").
- **generate-css lỗi** → chạy tay `bun run generate-css` trong repo đích; kiểm tên ảnh có đúng BEM không.
- **Ảnh item động ra `static-asset`** → 8 instance dùng chung 1 layer (cùng tên+size) nên tool đọc là tĩnh; đổi tay ở review hoặc mark `[bind:xxx]` trong PSD.
