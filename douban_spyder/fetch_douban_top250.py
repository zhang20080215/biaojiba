import requests
from bs4 import BeautifulSoup
import json
import time
import os
from urllib.parse import urlparse
from pathlib import Path

# 创建图片保存目录
IMAGE_DIR = Path('movie_covers')
IMAGE_DIR.mkdir(exist_ok=True)

def download_image(url, rank):
    """下载图片并保存到本地"""
    try:
        # 从URL中获取文件扩展名
        ext = os.path.splitext(urlparse(url).path)[1] or '.jpg'
        # 生成文件名：排名_时间戳.扩展名
        filename = f"{rank:03d}_{int(time.time())}{ext}"
        filepath = IMAGE_DIR / filename
        
        # 下载图片
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            with open(filepath, 'wb') as f:
                f.write(response.content)
            return str(filepath)
        return None
    except Exception as e:
        print(f"下载图片失败 {url}: {str(e)}")
        return None

movies = []

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36'
}

for start in range(0, 250, 25):
    url = f'https://movie.douban.com/top250?start={start}'
    print(f'抓取：{url}')
    res = requests.get(url, headers=headers)
    res.encoding = 'utf-8'
    soup = BeautifulSoup(res.text, 'html.parser')
    items = soup.find_all('div', class_='item')
    for item in items:
        rank = int(item.find('em').text)
        title = item.find('span', class_='title').text
        rating = float(item.find('span', class_='rating_num').text)
        cover_url = item.find('img')['src']
        year = item.find('div', class_='bd').find('p').text.strip().split('\n')[1].strip().split('/')[0].strip()
        info = item.find('div', class_='bd').find('p').text.strip().replace('\xa0', ' ')
        try:
            description = item.find('span', class_='inq').text.strip()
        except:
            description = ''
        
        # 下载图片
        print(f'下载电影海报：{title}')
        local_cover_path = download_image(cover_url, rank)
        
        movies.append({
            'rank': rank,
            'title': title,
            'rating': rating,
            'cover': cover_url,  # 原始URL
            'localCover': local_cover_path,  # 本地保存路径
            'year': year,
            'category': '',  # 豆瓣top250页面不直接显示类型，可以后续补充
            'description': description
        })
    time.sleep(1)  # 防止爬虫过快被封

# 保存为 movies.json
with open('movies.json', 'w', encoding='utf-8') as f:
    json.dump(movies, f, ensure_ascii=False, indent=2)

print('抓取完成，已保存为 movies.json')
print(f'图片保存在 {IMAGE_DIR} 目录下')
