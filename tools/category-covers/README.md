# 分类页云存储封面

分类页三张没有榜单集合可取封面的卡（每日电影 / 每日读书 / 全平台评分查询）的设计封面。
2026-09 起这三张图**不再随包发布**（原 `images/cover-*.jpg`），改放云存储，`pages/category/category.js`
对应主题行的 `image` 直接填 fileID。

上传方式：云开发控制台 → 存储 → 新建文件夹 `category_covers` → 上传本目录三个文件，**文件名保持不变**：

| 文件 | 主题卡 | fileID |
|---|---|---|
| `cover-daily-movie.jpg` | 每日电影 | `cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/category_covers/cover-daily-movie.jpg` |
| `cover-daily-read.jpg` | 每日读书（原 cover-douban-books.jpg） | `.../category_covers/cover-daily-read.jpg` |
| `cover-movie-search.jpg` | 全平台电影评分查询 | `.../category_covers/cover-movie-search.jpg` |

其余主题卡都走 `DYNAMIC_COVER_THEMES`（榜单 rank=1 / 最新一届的封面），不需要设计图。
本目录在 `packOptions.ignore`（整个 `tools/`）里，不进包。
