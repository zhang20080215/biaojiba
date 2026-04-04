// utils/chinesePosterDrawer.js - 华语高分电影海报绘制器

const TITLE = '豆瓣高分华语电影 TOP100 观影海报墙';

function ChinesePosterDrawer(canvasHelper) {
    this.helper = canvasHelper;
    this.ctx = canvasHelper.ctx;
}

ChinesePosterDrawer.prototype.getTitle = function () {
    return TITLE;
};

ChinesePosterDrawer.prototype.drawPosterWall = async function (movies, canvasSize, updateProgress) {
    const { width, height } = canvasSize;
    const padding = 40;
    const colsPerRow = 10;
    const gap = 12;

    const availableWidth = width - padding * 2;
    const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
    const posterHeight = Math.floor(posterWidth * 1.4);

    const posterAreaStartY = 280;
    const posterAreaHeight = height - posterAreaStartY - padding - 40;
    const maxRows = Math.floor(posterAreaHeight / (posterHeight + gap));
    const maxPosters = maxRows * colsPerRow;

    const displayMovies = movies.slice(0, maxPosters);
    const total = displayMovies.length;

    const batchSize = 8;
    for (let i = 0; i < displayMovies.length; i += batchSize) {
        const batch = displayMovies.slice(i, Math.min(i + batchSize, displayMovies.length));
        const batchPromises = batch.map((movie, index) => {
            const globalIndex = i + index;
            const row = Math.floor(globalIndex / colsPerRow);
            const col = globalIndex % colsPerRow;
            const x = padding + col * (posterWidth + gap);
            const y = posterAreaStartY + row * (posterHeight + gap);
            return this.drawSinglePoster(movie, x, y, posterWidth, posterHeight);
        });

        await Promise.all(batchPromises);

        if (updateProgress) {
            const progress = Math.floor(((i + batch.length) / total) * 100);
            updateProgress(progress);
        }
    }
};

ChinesePosterDrawer.prototype.drawSinglePoster = async function (movie, x, y, width, height) {
    const ctx = this.ctx;

    ctx.save();
    this.helper.drawRoundRectPath(x, y, width, height, 12);
    ctx.clip();
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(x, y, width, height);
    ctx.restore();

    try {
        let imageUrl = movie.cover || movie.coverUrl || movie.originalCover;
        if (!imageUrl) {
            throw new Error('无图片URL');
        }

        if (imageUrl.startsWith('cloud://')) {
            imageUrl = await this.helper.getCloudTempUrl(imageUrl);
        }

        const imagePath = await this.helper.loadImage(imageUrl);

        ctx.save();
        this.helper.drawRoundRectPath(x, y, width, height, 12);
        ctx.clip();
        ctx.drawImage(imagePath, x, y, width, height);

        ctx.strokeStyle = 'rgba(0,0,0,0.1)';
        ctx.lineWidth = 2;
        this.helper.drawRoundRectPath(x, y, width, height, 12);
        ctx.stroke();
        ctx.restore();

    } catch (err) {
        console.error(`绘制海报失败 [${movie.title}]:`, err);
        this._drawPlaceholder(movie.title, x, y, width, height);
    }
};

ChinesePosterDrawer.prototype._drawPlaceholder = function (title, x, y, width, height) {
    const ctx = this.ctx;

    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y, width, height);

    ctx.fillStyle = '#999';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬', x + width / 2, y + height / 2 - 10);

    ctx.fillStyle = '#666';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const maxWidth = width - 8;
    let displayTitle = title;
    if (ctx.measureText(title).width > maxWidth) {
        while (ctx.measureText(displayTitle + '...').width > maxWidth && displayTitle.length > 0) {
            displayTitle = displayTitle.slice(0, -1);
        }
        displayTitle += '...';
    }
    ctx.fillText(displayTitle, x + width / 2, y + height - 15);
};

module.exports = ChinesePosterDrawer;
