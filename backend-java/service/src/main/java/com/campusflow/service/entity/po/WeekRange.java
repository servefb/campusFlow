package com.campusflow.service.entity.po;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

public  class WeekRange {

    private static final Pattern PART = Pattern.compile("^(\\d+)(?:-(\\d+))?\\s*(单|双)?$");
    private static final int MAX_WEEK = 20; // 对应 175 字节（20周 * 7天 * 10节 = 1400位）
    private static final int PERIODS_PER_DAY = 10; // 每天节数（你之前假设的10节）
    private static final int DAYS_PER_WEEK = 7;    // 一周7天

    private WeekRange() {
    }

    // 1. 改为返回 byte[]
    public static byte[] toMask(String weekRange, Integer weekday, Integer start, Integer end) {
        // 2. 动态计算所需字节数（防止越界）
        int totalBits = MAX_WEEK * DAYS_PER_WEEK * PERIODS_PER_DAY; // 1400
        byte[] bitmap = new byte[(totalBits + 7) / 8]; // (1400 + 7) / 8 = 175 字节

        if (weekRange == null || weekRange.isBlank()) {
            throw new IllegalArgumentException("周次不能为空");
        }

        for (String raw : weekRange.split(",")) {
            String part = raw.trim();
            if (part.isEmpty()) continue;
            Matcher m = PART.matcher(part);
            if (!m.matches()) {
                throw new IllegalArgumentException("无法解析周次：" + part);
            }
            int from = Integer.parseInt(m.group(1));
            int to = m.group(2) != null ? Integer.parseInt(m.group(2)) : from;
            String parity = m.group(3);

            if (from < 1 || to > MAX_WEEK || from > to) {
                throw new IllegalArgumentException("周次超出范围：" + part);
            }

            for (int w = from; w <= to; w++) {
                if ("单".equals(parity) && w % 2 == 0) continue;
                if ("双".equals(parity) && w % 2 == 1) continue;

                // 3. 修正为 period <= end，包含结束节次
                for (int period = start; period <= end; period++) {
                    // 公式： (周次-1)*每周总节数 + (星期-1)*每天节数 + (节次-1)
                    int index = (w - 1) * DAYS_PER_WEEK * PERIODS_PER_DAY
                            + (weekday - 1) * PERIODS_PER_DAY
                            + (period - 1);

                    int byteIndex = index / 8;
                    int bitIndex = index % 8;
                    bitmap[byteIndex] |= (1 << (7 - bitIndex));
                }
            }
        }
        // 4. 返回生成的位图
        return bitmap;
    }
}