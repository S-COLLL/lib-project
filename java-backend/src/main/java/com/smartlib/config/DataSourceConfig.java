package com.smartlib.config;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.util.Collection;
import java.util.UUID;

import javax.sql.DataSource;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

/**
 * MySQL connection pool from the MYSQL_* settings (the same variables the Node.js version used).
 * MYSQL_SSL_CA may hold the CA certificate itself (PEM text, "\n" escapes allowed) or a path to the
 * .pem file; the connection is then encrypted and the server certificate verified against it.
 */
@Configuration
public class DataSourceConfig {

    @Bean
    public DataSource dataSource(Environment env) throws Exception {
        String host = env.getProperty("MYSQL_HOST", "localhost");
        String port = env.getProperty("MYSQL_PORT", "3306");
        String database = env.getProperty("MYSQL_DATABASE", "library_app");
        int poolSize = Integer.parseInt(env.getProperty("MYSQL_POOL_SIZE", "10"));

        StringBuilder url = new StringBuilder("jdbc:mysql://").append(host).append(':').append(port).append('/').append(database)
            .append("?tinyInt1isBit=false&zeroDateTimeBehavior=CONVERT_TO_NULL&characterEncoding=UTF-8");
        String ca = env.getProperty("MYSQL_SSL_CA", "");
        if (!ca.isBlank()) {
            String password = UUID.randomUUID().toString();
            Path trustStore = trustStore(ca, password);
            url.append("&sslMode=VERIFY_CA")
                .append("&trustCertificateKeyStoreUrl=").append(trustStore.toUri())
                .append("&trustCertificateKeyStoreType=PKCS12")
                .append("&trustCertificateKeyStorePassword=").append(password);
        } else if ("true".equals(env.getProperty("MYSQL_SSL"))) {
            url.append("&sslMode=VERIFY_IDENTITY");
        } else {
            url.append("&allowPublicKeyRetrieval=true");
        }

        HikariConfig config = new HikariConfig();
        config.setJdbcUrl(url.toString());
        config.setUsername(env.getProperty("MYSQL_USER", "root"));
        config.setPassword(env.getProperty("MYSQL_PASSWORD", ""));
        config.setMaximumPoolSize(poolSize);
        config.setMinimumIdle(Math.min(2, poolSize));
        config.setIdleTimeout(60_000);
        config.setKeepaliveTime(120_000);
        config.setConnectionTimeout(10_000);
        // Start even when the database is unreachable; requests then answer "database unavailable" until it is back.
        config.setInitializationFailTimeout(-1);
        config.setPoolName("smartlib");
        return new HikariDataSource(config);
    }

    /** Writes the PEM certificate(s) into a temporary PKCS12 trust store for the MySQL driver. */
    private static Path trustStore(String ca, String password) throws Exception {
        String pem = ca.contains("-----BEGIN") ? ca.replace("\\n", "\n") : Files.readString(Path.of(ca));
        CertificateFactory factory = CertificateFactory.getInstance("X.509");
        Collection<? extends Certificate> certs = factory.generateCertificates(new ByteArrayInputStream(pem.getBytes(StandardCharsets.US_ASCII)));
        KeyStore store = KeyStore.getInstance("PKCS12");
        store.load(null, password.toCharArray());
        int i = 0;
        for (Certificate cert : certs) store.setCertificateEntry("mysql-ca-" + i++, cert);
        Path file = Files.createTempFile("smartlib-mysql-ca", ".p12");
        file.toFile().deleteOnExit();
        try (OutputStream out = Files.newOutputStream(file)) {
            store.store(out, password.toCharArray());
        }
        return file;
    }
}
