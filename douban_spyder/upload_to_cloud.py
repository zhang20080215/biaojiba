import json
import os
import cloudbase
import time
from tcb_uploader import TcbUploader

# 初始化云开发
def init_cloud():
    env_id = 'cloud1-3gn3wryx716919c6'  # 替换为你的环境ID
    secret_id = 'AKIDnXwXwXwXwXwXwXwXwXwXwXwXwXwXwXw'  # 替换为你的secret_id
    secret_key = 'XwXwXwXwXwXwXwXwXwXwXwXwXwXwXwXwXw'  # 替换为你的secret_key
    return cloudbase.init(env_id, secret_id, secret_key)

def upload_image_to_cloud(local_path, cloud_path):
    """上传图片到云存储"""
    try:
        uploader = TcbUploader()
        result = uploader.upload_file(local_path, cloud_path)
        if result['code'] == 0:
            return result['fileID']
        else:
            print(f'上传图片失败: {result["message"]}')
            return None
    except Exception as e:
        print(f'上传图片出错: {str(e)}')
        return None

def main():
    # 初始化云开发
    cloud = init_cloud()
    db = cloud.database()
    
    # 读取本地电影数据
    with open('movies.json', 'r', encoding='utf-8') as f:
        movies = json.load(f)
    
    # 创建movies集合（如果不存在）
    try:
        db.create_collection('movies')
    except:
        pass
    
    # 上传数据到云数据库
    total = len(movies)
    success = 0
    failed = 0
    
    for i, movie in enumerate(movies, 1):
        try:
            # 上传电影海报到云存储
            local_image_path = os.path.join('movie_covers', f"{movie['rank']:03d}_{movie['title']}.jpg")
            if os.path.exists(local_image_path):
                cloud_path = f'movie_covers/{movie["rank"]:03d}_{movie["title"]}.jpg'
                file_id = upload_image_to_cloud(local_image_path, cloud_path)
                if file_id:
                    movie['cover'] = file_id  # 更新为云存储的fileID
            
            # 上传电影数据到数据库
            db.collection('movies').add({
                'data': movie
            })
            
            success += 1
            print(f'进度: {i}/{total} - 成功上传: {movie["title"]}')
            
            # 避免请求过快
            time.sleep(0.5)
            
        except Exception as e:
            failed += 1
            print(f'上传失败: {movie["title"]} - {str(e)}')
    
    print(f'\n上传完成！')
    print(f'总数: {total}')
    print(f'成功: {success}')
    print(f'失败: {failed}')

if __name__ == '__main__':
    main() 