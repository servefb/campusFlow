--[[
KEYS:
  KEYS[1] = token              幂等令牌
  KEYS[2] = stock              课程库存
  KEYS[3] = status             课程状态
  KEYS[4] = courseBitmap       课程位图
  KEYS[5] = studentBitmap      学生位图
  KEYS[6] = tmpBitmap          临时位图
  KEYS[7] = selectionQueue     落库队列
  KEYS[8] = studentSelected    学生已选课程 Set

ARGV:
  ARGV[1] = studentId
  ARGV[2] = offeringId
  ARGV[3] = termCode
  ARGV[4] = selectTime

返回值:
   1  = 选课成功
   0  = 重复提交（令牌失效）
  -1  = 库存不足
  -2  = 时间冲突
  -3  = 课程未开放
  -4  = 课程数据异常
  -6  = 已选过该课程
--]]

-- ========== 1. 幂等校验 ==========
if not redis.call('GET', KEYS[1]) then
	return 0
end
redis.call('DEL', KEYS[1])

-- ========== 2. 重复选课校验（新增） ==========
if redis.call('SISMEMBER', KEYS[8], ARGV[2]) == 1 then
	return -6
end

-- ========== 3. 校验课程状态 ==========
local status = redis.call('GET', KEYS[3])
-- 课程状态约定：1 = open，0 = closed。
if not status or status ~= "1" then
	return -3
end

-- ========== 4. 校验库存 ==========
local stock = redis.call('GET', KEYS[2])
if not stock or tonumber(stock) <= 0 then
	return -1
end

-- ========== 5. 校验课程位图 ==========
if redis.call('EXISTS', KEYS[4]) == 0 then
	return -4
end
if redis.call('BITCOUNT', KEYS[4]) == 0 then
	return -4
end

-- ========== 6. 校验时间冲突 ==========
redis.call('BITOP', 'AND', KEYS[6], KEYS[5], KEYS[4])
local conflict = redis.call('BITCOUNT', KEYS[6])
redis.call('DEL', KEYS[6])
if conflict > 0 then
	return -2
end

-- ========== 7. 扣库存 ==========
redis.call('DECR', KEYS[2])

-- ========== 8. 更新学生位图 ==========
redis.call('BITOP', 'OR', KEYS[6], KEYS[5], KEYS[4])
redis.call('RENAME', KEYS[6], KEYS[5])

-- ========== 9. 记录已选课程（新增） ==========
redis.call('SADD', KEYS[8], ARGV[2])

-- ========== 10. 推消息到落库队列 ==========
local message = cjson.encode({
	userId   = ARGV[1],
	offeringId  = ARGV[2],
})
redis.call('XADD', KEYS[7], '*', 'data', message)

return 1
