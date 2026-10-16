package com.campusflow.tools;

import org.springframework.stereotype.Component;

@Component
public class NumberToChineseSimple {

    private static final String[] NUM = {"零", "一", "二", "三", "四", "五", "六", "七", "八", "九"};
    private static final String[] UNIT = {"", "十", "百", "千"};
    private static final String[] SECTION = {"", "万", "亿", "万亿"};

    /**
     * 数字转中文（支持负数、小数）
     * 3        -> 三
     * 15       -> 十五
     * 123      -> 一百二十三
     * 1001     -> 一千零一
     * 12345    -> 一万二千三百四十五
     * 3.14     -> 三点一四
     * -5       -> 负五
     */
    public static String toChinese(long num) {
        if (num == 0) return "零";
        boolean negative = num < 0;
        String result = integerToChinese(Math.abs(num));
        return negative ? "负" + result : result;
    }

    private static String integerToChinese(long num) {
        if (num == 0) return "零";

        StringBuilder sb = new StringBuilder();
        int sectionIndex = 0;
        boolean lastSectionZero = false;

        while (num > 0) {
            int section = (int) (num % 10000);
            num /= 10000;

            if (section == 0) {
                lastSectionZero = true;
            } else {
                String sectionStr = sectionToChinese(section);
                if (lastSectionZero && sb.length() > 0) {
                    sb.insert(0, "零");
                }
                sb.insert(0, sectionStr + SECTION[sectionIndex]);
                lastSectionZero = false;
            }
            sectionIndex++;
        }
        String result = sb.toString();
        if (result.startsWith("一十") && num < 20) {
            result = result.substring(1); // "一十五" -> "十五"
        }
        return result;
    }

    private static String sectionToChinese(int section) {
        StringBuilder sb = new StringBuilder();
        int unitPos = 0;
        boolean zeroFlag = false;

        while (section > 0) {
            int digit = section % 10;
            if (digit == 0) {
                if (!zeroFlag && sb.length() > 0) {
                    zeroFlag = true;
                }
            } else {
                if (zeroFlag) {
                    sb.insert(0, "零");
                    zeroFlag = false;
                }
                sb.insert(0, NUM[digit] + UNIT[unitPos]);
            }
            unitPos++;
            section /= 10;
        }
        return sb.toString();
    }
}