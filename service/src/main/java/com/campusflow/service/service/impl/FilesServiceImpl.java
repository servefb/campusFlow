package com.campusflow.service.service.impl;

import com.campusflow.common.constant.ActionConstant;
import com.campusflow.common.constant.FileConstant;
import com.campusflow.common.constant.RabbitMqConstant;
import com.campusflow.common.context.UserContext;
import com.campusflow.common.exception.NotFoundException;
import com.campusflow.common.exception.StorageException;
import com.campusflow.common.response.Result;
import com.campusflow.service.config.MinioConfig;
import com.campusflow.service.entity.dto.FileScanMessage;
import com.campusflow.service.entity.dto.MinioObjectKey;
import com.campusflow.service.entity.dto.PostFileDto;
import com.campusflow.service.entity.po.Files;
import com.campusflow.service.entity.po.KnowledgeCategories;
import com.campusflow.service.entity.po.Users;
import com.campusflow.service.entity.vo.FileMetaVo;
import com.campusflow.service.entity.vo.PostFileVo;
import com.campusflow.service.mapper.FilesMapper;
import com.campusflow.service.mapper.UsersMapper;
import com.campusflow.service.service.IFilesService;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.campusflow.service.service.IKnowledgeCategoriesService;
import com.campusflow.service.service.IUsersService;
import io.minio.http.Method;
import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.catalina.mbeans.UserMBean;
import org.apache.commons.io.FilenameUtils;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.object.UpdatableSqlQuery;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.InvalidPathException;
import java.nio.file.Paths;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * <p>
 * 服务实现类
 * </p>
 *
 * @author JIA
 * @since 2026-09-04
 */
@Service
@Slf4j
@AllArgsConstructor
public class FilesServiceImpl extends ServiceImpl<FilesMapper, Files> implements IFilesService {

    private MinioService minioService;

    private MinioConfig minioConfig;
    private RabbitTemplate rabbitTemplate;
    private UsersMapper usersMapper;
    private StringRedisTemplate stringRedisTemplate;
    private FilesMapper filesMapper;

    private IKnowledgeCategoriesService knowledgeCategoriesService;
    private static final Set<String> WINDOWS_RESERVED = Set.of(
            "CON", "PRN", "AUX", "NUL",
            "COM1", "COM2", "COM3", "COM4", "COM5",
            "COM6", "COM7", "COM8", "COM9",
            "LPT1", "LPT2", "LPT3", "LPT4", "LPT5",
            "LPT6", "LPT7", "LPT8", "LPT9"
    );

    // 所有平台通用的非法字符（Windows + Unix 交集）
    private static final Pattern ILLEGAL_CHARS = Pattern.compile("[<>:\"/\\\\|?*\\x00-\\x1F]");

    // 路径遍历模式
    private static final Pattern PATH_TRAVERSAL = Pattern.compile("\\.\\./|\\.\\.\\\\");

    private static boolean isValidFilename(String input) {
        if (input == null || input.isBlank()) {
            return false;
        }

        // 1. 截取纯文件名（去掉路径部分）
        String filename = FilenameUtils.getName(input);
        if (filename.isEmpty()) {
            return false;
        }

        // 2. 空字节与路径遍历检查
        if (filename.contains("\0") || PATH_TRAVERSAL.matcher(filename).find()) {
            return false;
        }

        // 3. 非法字符检查
        if (ILLEGAL_CHARS.matcher(filename).find()) {
            return false;
        }

        // 4. 不能以空格或点号结尾（Windows 规则）
        if (filename.endsWith(" ") || filename.endsWith(".")) {
            return false;
        }

        // 5. Windows 保留名检查（不含扩展名）
        String baseName = FilenameUtils.getBaseName(filename).toUpperCase();
        if (WINDOWS_RESERVED.contains(baseName)) {
            return false;
        }

        // 6. 长度检查：UTF-8 字节数不超过 255
        if (filename.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 255) {
            return false;
        }
        try {
            Paths.get(filename);
        } catch (InvalidPathException e) {
            return false;
        }

        return true;
    }


    @Override
    public Result<PostFileVo> presign(PostFileDto postFileDto, MultipartFile file) throws NoSuchAlgorithmException {
        if (postFileDto == null || file == null) {
            throw new IllegalArgumentException("参数为空");
        }
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = file.getInputStream();
             DigestInputStream dis = new DigestInputStream(in, digest)) {
            byte[] buf = new byte[8192];
            while (dis.read(buf) != -1) {
            }
        } catch (IOException e) {
            throw new RuntimeException(e);
        }

        String serverHash = HexFormat.of().formatHex(digest.digest());
        Files existFile = lambdaQuery().eq(Files::getSha256, serverHash).eq(Files::getSizeBytes, file.getSize()).one();
        if (existFile != null) {
            throw new StorageException("500", "文件已经存在请不要重复上传");
        }
        Files files = new Files();
        if (!isValidFilename(postFileDto.getFilename())) {
            throw new IllegalArgumentException("Invalid filename");
        }

        files.setOriginalName(postFileDto.getFilename());
        files.setContentType(file.getContentType());
        files.setSizeBytes(file.getSize());
        files.setPurpose(postFileDto.getPurpose());
        files.setOwnerId(UserContext.getUserId());
        files.setSha256(serverHash);
        Long userId = UserContext.getUserId();
        files.setObjectKey(buildObjectName(postFileDto.getPurpose(), userId.toString(), postFileDto.getFilename()));
        PostFileVo postFileVo = new PostFileVo();


        if (!save(files)) {
            throw new StorageException("500", "Failed to save file metadata");
        }
        postFileVo.setFile_id(files.getId());
        postFileVo.setUpload_method(Method.PUT.toString());
        postFileVo.setHeaders(new PostFileVo.Headers(file.getContentType()));
        postFileVo.setExpires_in(7200);
        try {
            minioService.uploadFile(file, files.getObjectKey());
            postFileVo.setUpload_url(minioService.getPresignedGetUrl(files.getObjectKey(), java.time.Duration.ofHours(2)));

        } catch (Exception e) {
            throw new StorageException("500", "文件上传云端失败");
        }
        Integer i = filesMapper.updateStatusById(files.getId(), FileConstant.UPLOADED);
        if (i == null || i != 1) {
            throw new StorageException("500", "Failed to update file status");
        }
        try {
            rabbitTemplate.convertAndSend(
                    RabbitMqConstant.FILE_SCAN_EXCHANGE,
                    RabbitMqConstant.FILE_CAMPUSFLOW_ROUTING_KEY,
                    new FileScanMessage(files.getId()));
        } catch (Exception e) {
            // ⚠️ 投递失败不把上传整体判失败：字节已经安全落在 MinIO 里，此时抛出 500 会让用户重传，
            // 而 sha256 去重会把他挡在「文件已经存在请不要重复上传」上 —— 比报错更难处理。
            // 正确姿势是让文件停在 uploaded，由补偿任务/运维重投（见 FileConstant.UPLOADED 的注释）。
            log.error("文件上传成功但扫描任务投递失败，status 停在 uploaded，需要重投：fileId={}",
                    files.getId(), e);
        }
        if (postFileDto.getPurpose().equals("avatar")) {
            Users byId = usersMapper.selectById(userId);
            byId.setAvatarFileId(files.getId());
            usersMapper.updateById(byId);
            stringRedisTemplate.delete("user:avatar:" + userId);
        }
        return new Result<PostFileVo>().success(postFileVo);
    }

    @Override
    public Result text(MultipartFile file) {
        Files files = new Files();
        files.setOriginalName(file.getOriginalFilename());
        files.setContentType(file.getContentType());
        files.setSizeBytes(file.getSize());
        files.setPurpose("test");
        files.setOwnerId(UserContext.getUserId());
        String s = buildObjectName("test", "1", file.getOriginalFilename());
        files.setObjectKey(s);
        save(files);
        try {
            minioService.uploadFile(file, s);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return new Result().success();
    }

    /**
     * 文件元数据与扫描状态（契约文档 §9 的 {@code GET /files/{file_id}}）。
     *
     * <p>纯读库，<b>不碰对象存储</b> —— 管理端是每 1.2s 轮询一次
     * （`campusflowadmin/src/services/files.ts` 的 {@code waitForFileReady}），
     * 这里要是顺手取一次 MinIO 预签名地址，等于把一次上传放大成几十次对象存储往返。
     * 真要下载地址请另走 {@code GET /files/{file_id}/download-url}（契约里有，目前前端无调用方）。
     *
     * <p>⚠️ {@code status} 原样返回，**不做任何"友好化"** —— 理由见 {@link FileMetaVo} 类注释：
     * 把 {@code scanning} 说成 {@code ready} 等于拆掉安全扫描这道闸门。
     */
    @Override
    public Result<FileMetaVo> getFile(Long fileId) {
        if (fileId == null) {
            throw new IllegalArgumentException("file_id 不能为空");
        }
        Files file = getById(fileId);

        // 三种"查不到"合并成同一个 404：不存在 / 已逻辑删除 / 不属于当前用户。
        // 不分开回话的理由：分开就等于把「这个 id 是否存在」告诉任何登录用户，
        // 枚举 id 就能探测出别人上传过多少文件（文件数、时间规律都是信息）。
        if (file == null
                || file.getDeletedAt() != null
                || FileConstant.DELETED.equals(file.getStatus())) {
            throw new NotFoundException("文件不存在");
        }
        Long currentUserId = UserContext.getUserId();
        if (currentUserId == null || !currentUserId.equals(file.getOwnerId())) {
            throw new NotFoundException("文件不存在");
        }

        FileMetaVo vo = new FileMetaVo();
        vo.setFile_id(file.getId());
        vo.setFilename(file.getOriginalName());
        vo.setContent_type(file.getContentType());
        vo.setSize_bytes(file.getSizeBytes());
        vo.setPurpose(file.getPurpose());
        vo.setStatus(file.getStatus());
        return new Result<FileMetaVo>().success(vo);
    }


    public static String buildObjectName(String purpose, String bizId, String originalName) {
        String ext = "";
        if (originalName != null && originalName.contains(".")) {
            ext = originalName.substring(originalName.lastIndexOf(".")).toLowerCase();
        }
        String uuid = UUID.randomUUID().toString().replace("-", "");
        String date = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMM"));

        // purpose 决定前缀
        String prefix = switch (purpose) {
            case "knowledge_source" -> "knowledge/" + bizId + "/";
            case "task_material" -> "materials/" + bizId + "/";
            case "avatar" -> "avatar/" + bizId + "/";
            case "message_attachment" -> "message/" + bizId + "/";
            case "news_cover" -> "news/" + bizId + "/";
            default -> "temp/" + date + "/";
        };

        return prefix + uuid + ext;
    }
}
