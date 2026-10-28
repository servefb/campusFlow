# Spring AI 用法（面向本项目的落地版）

> 核对时间：2026-09-21。版本事实来自 docs.spring.io/spring-ai/reference 与官方 release blog，不是记忆。

## 0. 先选版本线（这步错了后面全白写）

| 你的 Spring Boot | 该用哪条线 | 基线 | 备注 |
| --- | --- | --- | --- |
| 4.0.x / 4.1.x | **2.0.1**（当前稳定） | Spring Framework 7 + Jackson 3 + Java 17 | 2026-08-20 发布，修了 7 个 CVE（PDF 读取、ONNX 模型缓存、Redis 仓库、工具分发等）。**正在跑 2.0.0 的应优先升到 2.0.1** |
| 3.5.x | **1.1.8** | Boot 3.5 | 维护线，2026-06-12 |
| 3.4.x | 1.0.9 | Boot 3.4 | 维护线 |

⚠️ 2.0 **不能**用在 Boot 3.x 上，它是大版本跳（Options 体系重构、Jackson 2→3、JSpecify 空安全）。本项目 Java 侧若是 Boot 3.x，直接看 §8 的「1.1.x 写法」，别硬升。

---

## 1. 依赖

BOM（二选一版本号）：

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>org.springframework.ai</groupId>
      <artifactId>spring-ai-bom</artifactId>
      <version>2.0.1</version>   <!-- Boot 3.5 的项目换成 1.1.8 -->
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

按需引入 starter（版本由 BOM 管，不用写 version）：

```xml
<!-- 聊天模型：OpenAI 官方 SDK 实现。2.0 里它同时是「接任何 OpenAI 兼容端点」的入口 -->
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-model-openai</artifactId>
</dependency>

<!-- 只做检索/RAG Advisor 时：QuestionAnswerAdvisor、VectorStoreChatMemoryAdvisor 在这个模块里 -->
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-vector-store-advisor</artifactId>
</dependency>

<!-- 要 RetrievalAugmentationAdvisor / 模块化 RAG 时 -->
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-rag</artifactId>
</dependency>

<!-- 向量库：坐标形如 spring-ai-starter-vector-store-<impl>，如 -pgvector / -chroma。
     具体实现名以 reference「Vector Databases」对应章节为准 -->
<dependency>
  <groupId>org.springframework.ai</groupId>
  <artifactId>spring-ai-starter-vector-store-pgvector</artifactId>
</dependency>
```

🔴 **实现约束（官方明确写了）**：流式只支持 Reactive 栈，非流式只支持 Servlet 栈。所以

- 命令式（Servlet）应用要用 `.stream()` → 必须额外引入 `spring-boot-starter-webflux`（只是把 Reactor 拉进来，Boot 只要 classpath 里有 spring-webmvc 就仍按 Servlet 启动，不会把你的应用变成 WebFlux）；
- 纯 WebFlux 应用要用非流式 → 必须引入 `spring-boot-starter-web`。

---

## 2. 配置：指向你们那套 OpenAI 兼容网关

```properties
# 连接级
spring.ai.openai.base-url=https://<你们的网关>/v1
spring.ai.openai.api-key=${LLM_API_KEY}

# 模型级（可覆盖上面的 base-url / api-key）
spring.ai.openai.chat.model=deepseek-flash
spring.ai.openai.chat.temperature=0.3
```

### 🔴 与我们踩过的 422 直接相关：reasoning_effort

**Spring AI 2.0 的 OpenAI 模块里没有 `reasoning_effort` 这个属性**（推理模型只暴露 `max-completion-tokens`，推理内容是从响应元数据 `reasoningContent` 里读的）。而我们的网关**只认** `none/minimal/low/medium/high/xhigh/max`，传 `balance`、`off` 之类直接 422 —— Python 侧就是栽在这上面（`llm_node` 那个默认值 `"balance"`）。

在 Java 侧透传这类网关私有参数，走 `extra-body`（会被**扁平化到请求体顶层**，正合网关的胃口）：

```properties
spring.ai.openai.chat.extra-body.reasoning_effort=none
```

或运行时按档位传：

```java
OpenAiChatOptions.builder()
    .model("deepseek-flash")
    .extraBody(Map.of("reasoning_effort", "high"))   // 只放白名单里的值
    .build();
```

⚠️ `extraBody` 是给**兼容服务器**用的，官方 OpenAI API 会因严格校验返 400 —— 我们用网关，正是它的目标场景。前端传档位时务必在 Java 侧也做一次白名单归一（与 Python 侧 `normalize_reasoning_effort()` 对齐），否则同一个坑会跨语言重演。

---

## 3. 最小可用：ChatClient

ChatClient 是 2.0 唯一推荐入口（ChatModel 降级为构建块）。

```java
@Configuration
class AiConfig {
    @Bean
    ChatClient chatClient(ChatClient.Builder builder) {
        return builder
            .defaultSystem("你是校园事务智能助手……")   // 相当于 system prompt
            // .defaultAdvisors(...)                    // 全局 advisor，见 §5 §6
            .build();
    }
}
```

三种调用形态：

```java
// ① 只要文本
String text = chatClient.prompt().user(q).call().content();

// ② 结构化输出：直接给 record/POJO，框架负责按 schema 约束并解析
record Route(String domain, double confidence, String reason) {}
Route route = chatClient.prompt().user(q).call().entity(Route.class);

// ③ 流式（Flux<String>，配合 §4 转成我们的 SSE 契约）
Flux<String> flux = chatClient.prompt().user(q).stream().content();
```

运行时改参数（2.0 传的是 **Builder**，不是构建好的实例）：

```java
chatClient.prompt()
    .options(OpenAiChatOptions.builder().temperature(0.1).model("deepseek-flash"))
    .user(q).call().content();
```

---

## 4. 把 Flux 包成我们的 SSE 契约

我们的帧序列是 `accepted → route → (title) → token → think → step/tool/tool_result → done|error`，Spring AI 只给字符流，事件名得自己发。Servlet 栈用 `SseEmitter`：

```java
@PostMapping(value = "/conversations/messages/stream",
             produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter streamQuestion(@RequestBody StreamReq req) {
    SseEmitter emitter = new SseEmitter(0L);          // 0 = 不超时
    send(emitter, "accepted", Map.of("conversation_id", cid));

    Disposable sub = chatClient.prompt()
        .user(req.content())
        .options(OpenAiChatOptions.builder()
            .extraBody(Map.of("reasoning_effort", normalizeEffort(req.thinkingLevel()))))
        .stream()
        .content()
        .subscribe(
            delta -> sendQuietly(emitter, "token", Map.of("delta", delta)),
            err   -> { sendQuietly(emitter, "error", Map.of("message", friendly(err))); emitter.complete(); },
            ()    -> { sendQuietly(emitter, "done", Map.of()); emitter.complete(); });

    // 🔴 客户端断开时必须取消上游，否则网关那侧的连接不会释放
    emitter.onCompletion(sub::dispose);
    emitter.onTimeout(sub::dispose);
    return emitter;
}

private void send(SseEmitter e, String event, Object data) throws IOException {
    e.send(SseEmitter.event().name(event).data(data, MediaType.APPLICATION_JSON));
}

private void sendQuietly(SseEmitter e, String event, Object data) {
    try { send(e, event, data); } catch (IOException ignored) { /* 对端已断 */ }
}
```

几个要点：

- `SseEmitter.send()` 内部是同步的，从 Reactor 线程回调里发是安全的；但**别在回调里做重活**（会堵住流）。
- `think`（推理内容）在 2.0 里不在 `content()` 里，要从 `stream().chatResponse()` 拿 `AssistantMessage.getMetadata().get("reasoningContent")`，再按我们的规则落库/推送。
- 我们契约里 `channel`/`step`/`tool` 这类帧 Spring AI 不产生，需要 **Tool 回调 + 自定义 Advisor** 自己发（见 §5）。
- 上游是「一条消息跑完才落库」的语义时，落库动作放在 `onComplete` 里同步做，别指望别的钩子。

---

## 5. 工具调用（2.0 有架构级变化）

```java
class CampusTools {
    @Tool(description = "查询某类校园事务的办理流程")
    String queryFlow(@ToolParam(description = "事务名称") String name) { ... }
}

String answer = chatClient.prompt()
    .user("补办学生证要哪些材料？")
    .tools(new CampusTools())        // 2.0：tools(...)，不再叫 functions(...)
    .call()
    .content();
```

2.0 关键变化（从 1.x 迁移必看）：

- `FunctionCallback` → **`ToolCallback`**；`FunctionCallbacks.builder()` → `FunctionToolCallback.builder(name, fn)`；
  `ChatClient.Builder#defaultFunctions` → **`defaultTools`**；`prompt().functions(...)` → **`prompt().tools(...)`**。
- **ChatModel 不再自动执行工具循环**：`chatModel.call()/stream()` 现在只返回模型的原始响应，工具不会被自动调用。要么走 ChatClient（自动注册 `ToolCallingAdvisor`），要么自己用 `ToolCallingManager` 驱动。
- ChatClient **总是**自动注册 `ToolCallingAdvisor`。原来手动加过 `ToolCallAdvisor` 的要去掉，否则重复执行；单次禁用：`.advisors(AdvisorParams.toolCallingAdvisorAutoRegister(false))`；全局关：`spring.ai.chat.client.tool-calling.enabled=false`。
- 2.0.1 新增工具调用次数上限（防 Agent 无限循环）与 `spring.ai.tools.resolution.fallback.enabled`。

> 想在过程区展示「第几步用了什么工具」（我们的 `step` / `tool_result` 帧），正确做法是写一个自定义 Advisor 包住工具调用，而不是去改模型实现 —— 这正是 2.0 把工具循环提到 advisor 链上的原因。

---

## 6. 多轮记忆

```java
ChatMemory memory = MessageWindowChatMemory.builder().maxMessages(20).build();
// 或持久化：JdbcChatMemoryRepository / RedisChatMemoryRepository

chatClient.prompt()
    .advisors(MessageChatMemoryAdvisor.builder(memory).build())
    .advisors(a -> a.param(ChatMemory.CONVERSATION_ID, conversationId))  // 🔴 必传
    .user(q).call().content();
```

⚠️ 2.0 起 **会话 ID 是必需的**：`ChatMemory.DEFAULT_CONVERSATION_ID` 与 `.conversationId()` 已移除，漏传抛 `IllegalArgumentException`。`PromptChatMemoryAdvisor` 也已移除（用 `MessageChatMemoryAdvisor`）。用 JDBC 仓储的注意 2.0 给表加了 `sequence_id BIGINT` 列，旧表要手工迁移。

---

## 7. RAG

### 7.1 最简单的 RAG Advisor

```java
var qaAdvisor = QuestionAnswerAdvisor.builder(vectorStore)
    .searchRequest(SearchRequest.builder().similarityThreshold(0.8d).topK(6).build())
    .build();

chatClient.prompt().advisors(qaAdvisor).user(q).call().content();

// 运行时换过滤条件（例如只检索某个分类）
chatClient.prompt()
    .advisors(a -> a.param(QuestionAnswerAdvisor.FILTER_EXPRESSION, "category == 'award'"))
    .user(q).call().content();
```

### 7.2 模块化 RAG

```java
Advisor rag = RetrievalAugmentationAdvisor.builder()
    .documentRetriever(VectorStoreDocumentRetriever.builder()
        .vectorStore(vectorStore)
        .similarityThreshold(0.50)
        .topK(5)
        .build())
    .queryAugmenter(ContextualQueryAugmenter.builder().allowEmptyContext(true).build())
    .build();
```

⚠️ 默认**不允许检索结果为空**（空了会让模型直接拒答）。校园问答里「库里确实没有」是常态，记得 `allowEmptyContext(true)` 并让模型如实说「知识库里没有依据」，这与我们前端 `grounded` 的语义一致。

### 7.3 写入向量库

```java
List<Document> docs = new TokenTextSplitter().apply(rawDocuments);  // 分块
vectorStore.add(docs);

// 检索
List<Document> hits = vectorStore.similaritySearch(
    SearchRequest.builder().query(q).topK(5).similarityThreshold(0.7).build());

// 删除（按 id 或按过滤条件）
vectorStore.delete(List.of(id));
vectorStore.delete("document_id == '42'");
```

### 7.4 🔴 与现有 Python 侧 Chroma 共存的两条硬约束

1. **嵌入模型必须一致**。同一批向量既有 Python 写的又有 Java 写的，只要两次用的 embedding 模型/维度不同，检索结果就是错的（不报错，只是召回乱）。collection 名我们也已经约定用 `category code`（`search_with_db` 的 kb_id 也是 code），Java 侧别自己另起名。
2. **别搞两套写入口**。现在入库那条链路（`files.purpose='knowledge_doc'` → 管理端确认 → Python 解析分块写 Chroma）已经跑通并有幂等、状态机、失败重试。Java 侧若再直连向量库写入，会出现「同一份文档两个版本、删一个还剩一个」的状态漂移。**Java 要检索就只读**（`VectorStoreRetriever`），写入仍交 Python。

---

## 8. 1.1.x（Boot 3.5）写法差异速查

| 项 | 1.1.x | 2.0.x |
| --- | --- | --- |
| Options | `OpenAiChatOptions.builder()...build()`，可 `copy()` / `fromOptions()` | 严格不可变，**`copy()`/`fromOptions()` 移除** → 用 `original.mutate().xxx().build()` |
| 配置键（非 chat 模型） | `spring.ai.openai.embedding.options.model` | **`spring.ai.openai.embedding.model`**（`.options` 段去掉，旧键作为 deprecated 暂留） |
| `.options()` 参数 | `ChatOptions` 实例 | `ChatOptions.Builder` |
| 工具 | `FunctionCallback` / `functions(...)` | `ToolCallback` / `tools(...)` |
| 工具执行 | ChatModel 内部循环 | 循环移到 `ToolCallingAdvisor`，ChatModel 只返原始响应 |
| 记忆 | 会话 ID 可省 | **必传**，`DEFAULT_CONVERSATION_ID` 移除 |
| Advisor 坐标 | `spring-ai-advisors-vector-store` | **`spring-ai-vector-store-advisor`** |
| Azure / openai-sdk 模块 | 独立模块 | **移除**，统一走 `spring-ai-openai` |
| 默认值位置 | 部分在配置属性 | 统一在 Options 层 |

---

## 9. 高频踩坑清单

1. **`.stream()` 报错说没有 Reactive 栈** → 补 `spring-boot-starter-webflux`（§1 的实现约束）。
2. **网关 422 `reasoning_effort` 不认** → 值必须落在网关白名单里，且只能通过 `extra-body` 传（§2）。
3. **`extraBody` 在官方 OpenAI 上 400** → 它是给兼容服务器用的，别指向 api.openai.com。
4. **`IllegalArgumentException: conversation id is required`** → 2.0 记忆 Advisor 必传 `CONVERSATION_ID`（§6）。
5. **工具被调用两次** → 2.0 的 `ToolCallingAdvisor` 自动注册，手工别再加。
6. **`max-tokens` 与 `max-completion-tokens` 同设报错** → builder 是 last-set-wins 且会告警，推理模型只用后者。
7. **RAG 永远答「不知道」** → 检查 `allowEmptyContext` 与相似度阈值；阈值 0.8 在中文短问句上经常全场落空，建议 0.5~0.6 起调。
8. **流式不结束/连接泄漏** → `SseEmitter` 的 `onCompletion`/`onTimeout` 里必须 `dispose()` 上游订阅（§4）。
9. **JDBC 记忆升级后报列不存在** → 手工补 `sequence_id BIGINT`（§6）。
10. **升级前先确认供应商还在支持列表里**：2.0 砍了 Azure OpenAI 模块、`openai-sdk` 变体、Google Vertex、Minimax 专用支持。我们用 OpenAI 兼容网关，正好在保留项里。

---

## 10. 参考

- 参考文档：https://docs.spring.io/spring-ai/reference/
- 升级说明（1.1 → 2.0 破坏性变更）：https://docs.spring.io/spring-ai/reference/upgrade-notes.html
- 2.0.0 GA 公告：https://spring.io/blog/2026/06/12/spring-ai-2-0-0-GA-available-now
- ChatClient / OpenAI Chat / RAG / Vector Databases 四章是日常最常翻的。
