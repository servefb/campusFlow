# 抢课压测

本目录是抢课相关的压力测试脚本与准备数据，均为本地压测环境使用。

## 文件

| 文件 | 用途 |
| --- | --- |
| `course-grab-stress.jmx` | 多人同时抢同一开课班（每线程一个学生），校验不超卖、成功次数与人数增量一致 |
| `course-same-user-stress.jmx` | 同一学生多线程同时选同一开课班，校验最多成功一次 |
| `course-grab-students.csv` | 学生账号列表（`account,password`），共 500 行，供多人抢课用 |
| `course-grab-200-setup.sql` | 200 人版本的准备脚本：建开课班 509、补齐 `stress051`～`stress200`、重置班级 |
| `course-grab-500-setup.sql` | 500 人版本的准备脚本：补齐 `stress201`～`stress500`、重置班级（需先执行 200 人版本） |

## 运行前准备

1. 在数据库执行准备脚本（按人数选择）：先 `course-grab-200-setup.sql`，需要 500 人时再执行 `course-grab-500-setup.sql`。两个脚本都会清空开课班 509 的选课记录。
2. 同一学生测试前，只清该学生的记录（脚本不会自动清）：

   ```sql
   DELETE FROM course_enrollments WHERE offering_id = 509 AND user_id = (SELECT id FROM users WHERE account = 'stress001');
   UPDATE course_offerings SET enrolled_count = (SELECT COUNT(*) FROM course_enrollments WHERE offering_id = 509 AND enrollment_status = 'selected') WHERE id = 509;
   ```

3. 后端启动在 `127.0.0.1:8080`。

## 运行

JMeter 的 GUI 里打开 `.jmx` 文件即可；命令行运行时，CSV 路径需要用绝对路径（JMeter 的相对路径以 `bin` 目录为基准）：

```bash
jmeter -n -t course-grab-stress.jmx -JstudentsFile=D:/worker-space/WebstormProjects/campusflow/perf/course-grab/course-grab-students.csv -Jthreads=500 -l result-grab.jtl
```

```bash
jmeter -n -t course-same-user-stress.jmx -Jthreads=50 -l result-same-user.jtl
```

注意：每次运行前都要重置数据，否则"抢课前人数"不是 0，断言结果无效。

## 判定标准

- **多人抢课**：容量 80 时，成功 80 人，其余为"名额已满"；`enrolled_count` 增量 = 成功次数，且不超过 capacity。
- **同一学生**：抢课前未选时，成功次数必须为 1；`enrolled_count` 增量 = 成功次数。

断言信息写在 JMeter 日志（`bin/jmeter.log`）里，搜索 `断言` 或 `同一学生压测结果` 即可看到。

## 已知事项

- 接口文档写的是 202 异步受理，实际服务端同步返回 HTTP 200 + `code:0`；满员返回 HTTP 500 + `code:500`，与文档中的 409 不一致。脚本以响应体 `code == 0` 判定成功，需与后端确认口径。
- 只用于本地环境，密码 `0706` 的哈希复制自 `2022010834`。不要在共享或生产环境运行。
