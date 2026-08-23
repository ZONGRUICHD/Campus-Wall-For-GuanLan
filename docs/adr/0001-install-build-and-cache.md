# ADR 0001：install、内容寻址构建与缓存生命周期

- 状态：已接受
- 日期：2026-08-24

## 背景

开发生命周期需要在空仓库缓存、重复执行、进程中断和产物替换时都能自行收敛。源码、组件与某一次构建运行没有从属关系，因此不能通过复制“版本目录”、绝对路径摘要或把构建号写回组件来建立身份。

## 决议

1. **只有幂等 `install`，没有 `update`。** 空状态会创建最小 manifest；完整状态重复执行保持不变；部分状态先回收遗留临时文件，再继续安装。
2. **原材料与产物分开寻址。** material digest 由规范化逻辑名称和文件字节组成，不含工作区绝对路径。artifact digest 只由最终输出字节组成。一个稳定 target 只引用它当前的 artifact；替换后旧对象自然失去引用并被 GC。
3. **每个 inode 一次短替换。** 写入发生在目标同目录临时文件，完成 `flush/fsync` 后使用 `os.replace`，manifest 最后替换。没有横跨多个文件的伪原子事务；任意时刻取消最多留下可识别临时文件，下一次 `install/build` 会自动回收。
4. **缓存主动维护。** `install/build` 每次运行都删除遗留临时文件、失去 manifest 引用的对象和超过 TTL 的 abandoned 项。显式 `clean` 删除仓库内所有可再生缓存，但保留 `node_modules`、虚拟环境、源码和业务数据库。
5. **镜像不绑定某次构建号。** Dockerfile 使用语言运行时的长期组件标识，不把提交号或流水线编号写入原材料。可读 tag 是指针；最终镜像由 OCI manifest/layer digest 唯一标识。
6. **迁移对业务数据负责。** 当前 API 是空状态首建，不伪造旧数据迁移。未来 schema 变化若影响已有数据，采用小型内联迁移或独立数据迁移步骤，并明确中断后如何重入。

## 依据

- OCI Descriptor 将 digest 定义为内容标识，镜像组件通过内容地址关联：[OCI Image Spec — Descriptor](https://github.com/opencontainers/image-spec/blob/main/descriptor.md)。
- Python 提供跨平台临时文件与原子替换原语：[tempfile](https://docs.python.org/3.14/library/tempfile.html)、[os.replace](https://docs.python.org/3.14/library/os.html#os.replace)。
- SQLAlchemy 建议明确事务起止并保持事务短小：[Session Basics](https://docs.sqlalchemy.org/en/20/orm/session_basics.html#when-do-i-construct-a-session-when-do-i-commit-it-and-when-do-i-close-it)。
- Docker BuildKit 会按闲置时间和空间策略周期回收构建缓存：[Build garbage collection](https://docs.docker.com/build/cache/garbage-collection/)。
- Alembic 将业务数据迁移视为需要按应用具体设计的问题：[Data Migrations](https://alembic.sqlalchemy.org/en/latest/cookbook.html#data-migrations-general-techniques)。

## 结果

路径移动不会制造新的 material identity；同一 target 的新构建不会让历史对象永久占用空间；中断恢复不依赖长事务或人工删除状态。代价是“一组文件整体切换”的可见一致性由最后写入的 manifest 提供，读者必须只从 manifest 发现当前对象，而不能扫描临时目录猜测状态。
