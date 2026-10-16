package com.campusflow.tools.fileUtils;

import java.util.HashMap;
import java.util.Map;

/**
 * 离线敏感词审核（DFA / Trie）。这一层不替代云审核，解决的是另外三件事：
 *
 * <ul>
 *   <li><b>零成本、零延迟、可离线</b>：不依赖任何外部服务，答辩现场断网也能演示；</li>
 *   <li><b>可解释、可留证</b>：命中的是哪个词、在第几位，都是确定的，能直接进 scan_result；</li>
 *   <li><b>抗绕过能力有限但要挡第一波</b>：明文命中先拦下，变体字/拼音绕过交给云审核和 LLM。</li>
 * </ul>
 *
 * <p>词库来源建议：学校已有的违规词表 + 法律法规公开的违禁词；词表放配置或数据库，别硬编码在类里。
 */
public class KeywordModerator implements Moderation {

    private final Node root = new Node();

    private static final class Node {
        final Map<Character, Node> children = new HashMap<>(4);
        boolean terminal;
    }

    public KeywordModerator(Iterable<String> words) {
        for (String w : words) {
            if (w != null && !w.isBlank()) {
                insert(w.trim());
            }
        }
    }

    private void insert(String word) {
        Node cur = root;
        for (int i = 0; i < word.length(); i++) {
            cur = cur.children.computeIfAbsent(word.charAt(i), k -> new Node());
        }
        cur.terminal = true;
    }

    /** 返回第一个命中的词（不区分大小写，做一次 toLowerCase）。没命中返回 null。 */
    public String firstHit(String text) {
        if (text == null || text.isEmpty()) {
            return null;
        }
        String s = text.toLowerCase();
        for (int i = 0; i < s.length(); i++) {
            Node cur = root;
            for (int j = i; j < s.length(); j++) {
                cur = cur.children.get(s.charAt(j));
                if (cur == null) {
                    break;
                }
                if (cur.terminal) {
                    return s.substring(i, j + 1);
                }
            }
        }
        return null;
    }

    @Override
    public Verdict moderate(String text) {
        String hit = firstHit(text);
        if (hit != null) {
            // ⚠️ 落 scan_result 时考虑脱敏：命中词本身是敏感内容，别把它原样回给前端展示。
            return Verdict.reject("high", "keyword", "命中违规词库（长度 " + hit.length() + "）。");
        }
        return Verdict.pass("未命中违规词库。");
    }
}
