// 云函数入口文件
const cloud = require('wx-server-sdk')
const fs = require('fs')
const path = require('path')
const axios = require('axios')

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
})

// 下载图片并上传到云存储
async function uploadImageToCloud(imageUrl, movieTitle, rank, retryCount = 0) {
  try {
    // 下载图片
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 15000, // 15秒超时
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    })
    
    // 生成云存储路径
    const cloudPath = `movie_covers/${rank}_${movieTitle}.jpg`
    
    // 上传到云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: response.data
    })
    
    // 获取图片的临时访问链接
    const fileList = [uploadResult.fileID]
    const result = await cloud.getTempFileURL({
      fileList
    })
    
    return result.fileList[0].tempFileURL
  } catch (e) {
    console.error(`上传图片失败: ${movieTitle}`, e)
    if (retryCount < 3) {
      console.log(`重试上传图片: ${movieTitle}, 第${retryCount + 1}次重试`)
      await new Promise(resolve => setTimeout(resolve, 2000)) // 等待2秒后重试
      return uploadImageToCloud(imageUrl, movieTitle, rank, retryCount + 1)
    }
    return imageUrl // 如果重试3次后仍然失败，返回原始URL
  }
}

// 云函数入口函数
exports.main = async (event, context) => {
  const db = cloud.database()
  const _ = db.command
  
  try {
    // 读取本地JSON文件
    const moviesData = require('./movies.json')
    
    // 创建movies集合（如果不存在）
    try {
      await db.createCollection('movies')
    } catch (e) {
      // 集合可能已存在，忽略错误
    }
    
    // 清空现有数据
    await db.collection('movies').where({
      _id: _.exists(true)
    }).remove()
    
    // 批量导入数据
    const total = moviesData.length
    const batchSize = 3 // 进一步减小批量大小
    let success = 0
    let failed = 0
    
    for (let i = 0; i < total; i += batchSize) {
      const batch = moviesData.slice(i, i + batchSize)
      const processedBatch = []
      
      // 处理每个电影的数据
      for (const movie of batch) {
        try {
          // 上传图片到云存储
          const cloudImageUrl = await uploadImageToCloud(movie.cover, movie.title, movie.rank)
          
          // 处理数据格式
          processedBatch.push({
            rank: movie.rank,
            title: movie.title,
            rating: movie.rating,
            cover: cloudImageUrl,  // 使用云存储的图片URL
            year: movie.year,
            category: movie.category || '',
            description: movie.description || ''
          })
          
          // 添加延迟，避免请求过快
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (e) {
          console.error(`处理电影数据失败: ${movie.title}`, e)
          failed++
          continue
        }
      }
      
      if (processedBatch.length > 0) {
        try {
          // 批量添加数据
          await db.collection('movies').add({
            data: processedBatch
          })
          success += processedBatch.length
          console.log(`进度: ${i + processedBatch.length}/${total}`)
        } catch (e) {
          console.error(`批量导入失败: ${e}`)
          failed += processedBatch.length
        }
      }
      
      // 每批处理完后等待更长时间
      await new Promise(resolve => setTimeout(resolve, 3000))
    }
    
    return {
      success: true,
      total,
      successCount: success,
      failedCount: failed
    }
    
  } catch (e) {
    console.error(e)
    return {
      success: false,
      error: e
    }
  }
}
