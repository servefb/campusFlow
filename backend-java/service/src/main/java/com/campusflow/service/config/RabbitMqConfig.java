package com.campusflow.service.config;

import com.campusflow.common.constant.RabbitMqConstant;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.springframework.amqp.core.Binding;
import org.springframework.amqp.core.BindingBuilder;
import org.springframework.amqp.core.ExchangeBuilder;
import org.springframework.amqp.core.Queue;
import org.springframework.amqp.core.QueueBuilder;
import org.springframework.amqp.core.TopicExchange;
import org.springframework.amqp.support.converter.Jackson2JsonMessageConverter;
import org.springframework.amqp.support.converter.MessageConverter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 文件扫描队列的声明。
 *
 * <h3>这里只留一条链路：上传 → 扫描</h3>
 * 原来的 {@code rag.file.exchange} / {@code rag.file.queue}（Java 发 → Python 消费入库）
 * 已随 2026-09-20 的入库改版废弃，不再声明。<b>那对队列如果还在 broker 上，是历史残留，
 * 可以放心删掉</b>（生产者其实从没投进去过，见下）。
 *
 * <h3>⚠️ 修掉的那个 bug：消息根本到不了这个队列</h3>
 * 原来 {@code FilesServiceImpl} 发的是
 * {@code rabbitTemplate.convertAndSend(routingKey, file)} —— 两个参数的重载把它当成了
 * <b>「默认交换机的 routingKey」</b>，而不是「某个交换机的 routingKey」。
 * 默认交换机是按<b>队列名</b>精确匹配的，可 {@code campusflowFilekey} 是个 routingKey、
 * 根本不是队列名，于是消息要么被静默丢弃，要么（带 mandatory 时）退回。
 * 加上载荷是 {@code MultipartFile}（servlet 对象，不可序列化），这条链路等于完全没通。
 * 现在改成三参数的 {@code convertAndSend(exchange, routingKey, payload)}，载荷只带 fileId。
 *
 * <h3>⚠️ 队列/交换机已存在时的一个坑</h3>
 * 交换机/队列的<b>类型和参数必须与 broker 上已有的一致</b>，否则 RabbitMQ 会以
 * {@code PRECONDITION_FAILED}（406）关掉 channel，应用起不来。
 * 这里沿用 {@code file.exchange} 作为 <b>topic</b>（原 {@code @QueueBinding} 声明的就是 topic），
 * 就是为了避免这种冲突。若哪天要把它改成 direct：先在控制台把同名交换机删掉再启动。
 */
@Configuration
public class RabbitMqConfig {

    /** 扫描队列。durable=true，消费者崩了消息不丢。 */
    @Bean
    public Queue fileScanQueue() {
        return QueueBuilder.durable(RabbitMqConstant.FILE_SCAN_QUEUE).build();
    }

    @Bean
    public TopicExchange fileScanExchange() {
        return ExchangeBuilder.topicExchange(RabbitMqConstant.FILE_SCAN_EXCHANGE).durable(true).build();
    }

    @Bean
    public Binding fileScanBinding(Queue fileScanQueue, TopicExchange fileScanExchange) {
        return BindingBuilder.bind(fileScanQueue)
                .to(fileScanExchange)
                .with(RabbitMqConstant.FILE_CAMPUSFLOW_ROUTING_KEY);
    }

    /**
     * 消息体用 JSON，而不是 JDK 序列化。
     *
     * <p>两个理由：① 在 RabbitMQ 控制台里能直接读懂消息内容，排障省一半时间；
     * ② 不把队列和 Java 类名绑死（JDK 序列化要求收发两端类名/版本完全一致）。
     *
     * <p>Spring Boot 的 {@code RabbitAutoConfiguration} 会自动把这个唯一的
     * {@link MessageConverter} Bean 装到 {@code RabbitTemplate} 上，不用手动 set。
     */
    @Bean
    public MessageConverter jsonMessageConverter() {
        ObjectMapper mapper = new ObjectMapper()
                .registerModule(new JavaTimeModule())
                .disable(SerializationFeature.WRITE_DATES_AS_TIMESTAMPS);
        return new Jackson2JsonMessageConverter(mapper);
    }
}
