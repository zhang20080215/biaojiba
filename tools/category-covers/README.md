# 分类页云存储封面

分类页没有榜单集合可取封面的五张卡（每日电影 / 每日读书 / 每日运动 / 每日喝水 / 全平台评分查询）的设计封面。
2026-09 起这些图**不再随包发布**（原 `images/cover-*.jpg`），改放云存储，`pages/category/category.js`
对应主题行的 `image` 直接填 fileID。

上传方式：云开发控制台 → 存储 → 新建文件夹 `category_covers` → 上传本目录五个 jpg，**文件名保持不变**：

| 文件 | 主题卡 | fileID |
|---|---|---|
| `cover-daily-movie.jpg` | 每日电影 | `cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/category_covers/cover-daily-movie.jpg` |
| `cover-daily-read.jpg` | 每日读书 | `.../category_covers/cover-daily-read.jpg` |
| `cover-daily-sport.jpg` | 每日运动 | `.../category_covers/cover-daily-sport.jpg` |
| `cover-daily-water.jpg` | 每日喝水 | `.../category_covers/cover-daily-water.jpg` |
| `cover-movie-search.jpg` | 全平台电影评分查询 | `.../category_covers/cover-movie-search.jpg` |

## 四张每日卡的图标规范（2026-09-17 定稿）

- **1:1，600×600 JPG**，8~12KB；卡片封面模式 `aspectFill` 裁 1.6:1、列表模式 1:1，所以主体居中、占画布约 55%
- 同一奶油白底 `#FDFBF4`，**单个主体**、无渐变无纹理无阴影无文字，最多三个小点缀
- 主体颜色对齐该卡 `brand` 主色：电影 橄榄绿场记板+金星 / 读书 橄榄绿封面翻开的书+金书签 / 运动 天蓝哑铃+橙点 / 喝水 青蓝水杯+水滴
- 生成方式：`baoyu-image-gen` 脚本 → OpenRouter `google/gemini-3.1-flash-image-preview`，`--ar 1:1`；模型偶尔自带圆角白边，用 ffmpeg 居中裁掉再缩到 600

其余主题卡都走 `DYNAMIC_COVER_THEMES`（榜单 rank=1 / 最新一届的封面），不需要设计图。
本目录在 `packOptions.ignore`（整个 `tools/`）里，不进包。
