package com.example.urly.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.springframework.data.annotation.Id;
import org.springframework.data.mongodb.core.mapping.Document;

import java.time.LocalDateTime;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Document(collection = "clicks")
public class Click {
    @Id
    private String id;

    private String urlId;

    @Builder.Default
    private LocalDateTime clickedAt = LocalDateTime.now();

    private String ipAddress;

    private String userAgent;
}
