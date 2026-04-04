const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const $ = db.command.aggregate;

exports.main = async (event, context) => {
  try {
    // 分页聚合，突破默认20条限制
    let allUsers = [];
    let skip = 0;
    const batchSize = 1000;
    while (true) {
      const res = await db.collection('Marks').aggregate()
        .group({
          _id: '$openid',
          total: $.sum(1),
          watched: $.sum($.cond({ if: $.eq(['$status', 'watched']), then: 1, else: 0 })),
          wish: $.sum($.cond({ if: $.eq(['$status', 'wish']), then: 1, else: 0 }))
        })
        .sort({ total: -1 })
        .skip(skip)
        .limit(batchSize)
        .end();
      allUsers = allUsers.concat(res.list);
      if (res.list.length < batchSize) break;
      skip += batchSize;
    }

    const users = allUsers;
    const buckets = [
      { label: '1-10', min: 1, max: 10, count: 0 },
      { label: '11-50', min: 11, max: 50, count: 0 },
      { label: '51-100', min: 51, max: 100, count: 0 },
      { label: '101-200', min: 101, max: 200, count: 0 },
      { label: '201-300', min: 201, max: 300, count: 0 },
      { label: '300+', min: 301, max: Infinity, count: 0 }
    ];

    let totalMarks = 0, totalWatched = 0, totalWish = 0;
    users.forEach(u => {
      totalMarks += u.total;
      totalWatched += u.watched;
      totalWish += u.wish;
      for (const b of buckets) {
        if (u.total >= b.min && u.total <= b.max) { b.count++; break; }
      }
    });

    return {
      success: true,
      totalUsers: users.length,
      totalMarks,
      avgPerUser: (totalMarks / users.length).toFixed(1),
      watchedPercent: (totalWatched / totalMarks * 100).toFixed(1) + '%',
      wishPercent: (totalWish / totalMarks * 100).toFixed(1) + '%',
      distribution: buckets.map(b => ({
        range: b.label,
        users: b.count,
        percent: (b.count / users.length * 100).toFixed(1) + '%'
      })),
      top20: users.slice(0, 20).map(u => ({
        id: u._id.substring(0, 8) + '...',
        total: u.total,
        watched: u.watched,
        wish: u.wish
      }))
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
};
