package com.example.urly.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.index.Indexed;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "urls")
public class Url {
    @Id
    private String id;

    @Indexed(unique = true)
    private String shortCode;

    private String originalUrl;

    private String title;

    private String description;

    private String favicon;

    @org.springframework.data.annotation.Transient
    private String shortUrl;

    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
