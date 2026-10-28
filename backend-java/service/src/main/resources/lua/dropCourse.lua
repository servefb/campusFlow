-- KEYS: studentSelected, studentBitmap, stock, tmpBitmap
-- ARGV: offeringId, offeringBitmapPrefix (contains the term hash tag)
-- Rebuild from Redis selections, including selections still awaiting DB persistence.
if redis.call('SISMEMBER', KEYS[1], ARGV[1]) == 0 then
    return 0
end
local bitmaps = {}
for _, id in ipairs(redis.call('SMEMBERS', KEYS[1])) do
    if id ~= ARGV[1] then
        local bitmapKey = ARGV[2] .. id
        if redis.call('TYPE', bitmapKey).ok ~= 'string' then
            return -1
        end
        table.insert(bitmaps, bitmapKey)
    end
end
local stock = redis.call('GET', KEYS[3])
if stock and (not tonumber(stock) or tonumber(stock) % 1 ~= 0) then
    return -1
end
-- Validate and prepare the replacement before removing the selection.
if #bitmaps > 0 then
    redis.call('BITOP', 'OR', KEYS[4], unpack(bitmaps))
end
redis.call('SREM', KEYS[1], ARGV[1])
if #bitmaps == 0 then
    redis.call('DEL', KEYS[2])
else
    redis.call('RENAME', KEYS[4], KEYS[2])
end
if stock then
    redis.call('INCR', KEYS[3])
end
return 1
