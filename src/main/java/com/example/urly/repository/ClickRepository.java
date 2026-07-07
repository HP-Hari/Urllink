package com.example.urly.repository;

import com.example.urly.model.Click;
import org.springframework.data.mongodb.repository.MongoRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ClickRepository extends MongoRepository<Click, String> {
    long countByUrlId(String urlId);
    List<Click> findTop100ByUrlIdOrderByClickedAtDesc(String urlId);
}
