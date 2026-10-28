
# Campus Flow Java 后端项目层级设计

推荐采用 **Maven 多模块项目**，最外层为父项目，统一管理依赖和版本。

## 一、整体项目结构

~~~text
campus-flow/
├── pom.xml                         # 父项目，统一管理依赖和版本
│
├── common/                         # 公共基础层
│   ├── pom.xml
│   └── src/
│       ├── main/java/com/campusflow/common/
│       │   ├── constant/           # 常量
│       │   ├── enums/              # 枚举
│       │   ├── exception/          # 自定义异常
│       │   ├── response/           # 统一响应对象
│       │   ├── result/             # 分页结果
│       │   ├── utils/              # 工具类
│       │   ├── annotation/         # 自定义注解
│       │   ├── context/            # 用户上下文
│       │   └── model/              # 公共基础模型
│       └── test/
│
├── service/                        # 核心业务服务层
│   ├── pom.xml
│   └── src/
│       ├── main/
│       │   ├── java/com/campusflow/service/
│       │   │   ├── CampusFlowApplication.java
│       │   ├── config/             # Spring、MyBatis-Plus、Redis 配置
│       │   ├── security/           # JWT、权限认证
│       │   ├── auth/               # 登录认证
│       │   ├── user/               # 用户管理
│       │   ├── conversation/       # 会话和消息
│       │   ├── task/               # 办事任务
│       │   ├── knowledge/          # 知识库文档
│       │   ├── news/               # 校园新闻
│       │   ├── file/               # 文件管理
│       │   ├── ai/                 # AI 服务业务编排
│       │   └── admin/              # 管理员数据看板
│       │
│       └── resources/
│           ├── application.yml
│           ├── application-dev.yml
│           ├── application-prod.yml
│           ├── mapper/             # MyBatis XML
│           └── db/migration/       # Flyway 数据库脚本
│
└── tools/                          # 外部工具和基础设施层
    ├── pom.xml
    └── src/main/java/com/campusflow/tools/
        ├── ai/                     # Python AI 服务客户端
        ├── http/                   # HTTP 客户端
        ├── storage/                # 文件存储
        ├── redis/                  # Redis 封装
        ├── excel/                  # Excel 导入导出
        ├── pdf/                    # PDF 处理
        └── notification/            # 消息通知
~~~

## 二、三个模块职责

### 1. common

公共基础层，不处理具体业务。

~~~text
统一返回结果、全局异常、分页对象、枚举、常量、工具类、用户上下文、公共注解
~~~

依赖原则：

~~~text
common 不依赖 service
common 不依赖具体业务模块
~~~

### 2. service

核心业务层，负责 Controller、Service、Mapper 和业务实体。

每个业务模块建议保持统一结构：

~~~text
conversation/
├── controller/
├── service/
│   └── impl/
├── mapper/
├── entity/
├── dto/
└── vo/
~~~

示例：

~~~text
task/
├── controller/TaskController.java
├── service/TaskService.java
├── service/impl/TaskServiceImpl.java
├── mapper/TaskMapper.java
├── entity/Task.java
├── dto/CreateTaskRequest.java
├── dto/SubmitTaskRequest.java
└── vo/TaskDetailVO.java
~~~

### 3. tools

外部能力和基础设施层，不负责具体业务流程。

~~~text
调用 Python AI 服务
调用第三方接口
文件上传和下载
Redis 封装
PDF、Excel 文件处理
消息通知
HTTP 请求封装
~~~

Java 不直接调用大模型，而是通过 tools.ai 调用 Python 服务：

~~~text
service/ai
    ↓
tools/ai/PythonAiClient
    ↓
Python AI Service
    ↓
LLM、RAG、多智能体、向量数据库
~~~

## 三、模块依赖关系

~~~text
service
   ├── common
   └── tools
          └── common
~~~

不建议出现：

~~~text
common → service
tools → service
service 的业务模块互相强依赖
~~~

## 四、父项目 pom.xml 模块配置

~~~xml
<packaging>pom</packaging>

<modules>
    <module>common</module>
    <module>tools</module>
    <module>service</module>
</modules>
~~~

service/pom.xml 依赖：

~~~xml
<dependency>
    <groupId>com.campusflow</groupId>
    <artifactId>common</artifactId>
</dependency>

<dependency>
    <groupId>com.campusflow</groupId>
    <artifactId>tools</artifactId>
</dependency>
~~~

## 五、建议的包命名

~~~text
com.campusflow
com.campusflow.common
com.campusflow.tools
com.campusflow.service
~~~

主启动类：

~~~text
com.campusflow.service.CampusFlowApplication
~~~

主启动类放在 service 包下，可以统一扫描 common 和 tools 中的 Spring Bean。

## 六、Java 与 Python 项目关系

Python 不作为 Java Maven 子模块，而作为独立服务：

~~~text
campus-flow/
├── campus-flow-java/
│   ├── pom.xml
│   ├── common/
│   ├── tools/
│   └── service/
│
└── campus-flow-ai/
    ├── app/
    ├── agents/
    ├── rag/
    ├── vector_store/
    └── requirements.txt
~~~

最终调用关系：

~~~text
前端
  ↓
Java Service
  ├── MySQL
  ├── Redis
  └── Tools
        ↓
   Python AI Service
        ├── Agent
        ├── RAG
        ├── 大模型
        └── 向量数据库
~~~

## 七、总结

- common：提供公共能力
- tools：负责外部工具和 Python 调用
- service：负责全部校园业务
- Python 服务：负责 AI、RAG 和多智能体能力

