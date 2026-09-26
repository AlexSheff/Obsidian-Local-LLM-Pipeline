import { describe, it, expect } from 'vitest';
import {
  detectDocumentLanguage,
  enforceTitleLanguage,
  ensureLanguageTags,
  hasCyrillic
} from '../src/server/language';

describe('Document Language Detection & Title/Tag Enforcement', () => {
  describe('detectDocumentLanguage', () => {
    it('detects Russian document and returns tag "ru"', () => {
      const text = `
# План разработки проекта Межпланетный Интернет

Необходимо организовать распределенную сеть узлов для передачи данных в условиях космических задержек.
Основные компоненты: буфер сообщений, маршрутизатор задержек, протокол DTN.
      `;
      const result = detectDocumentLanguage(text, 'Межпланетный_интернет.md');
      expect(result.primary).toBe('ru');
      expect(result.tags).toContain('ru');
      expect(result.hasCyrillic).toBe(true);
    });

    it('detects English document and returns tag "en"', () => {
      const text = `
# CleanNet Architecture Overview

This document outlines the distributed pipeline for data cleaning and token caching.
We use a balanced model pool running with context limit of 2048 to prevent memory exhaustion.
      `;
      const result = detectDocumentLanguage(text, 'CleanNet_Architecture.md');
      expect(result.primary).toBe('en');
      expect(result.tags).toContain('en');
      expect(result.hasCyrillic).toBe(false);
    });

    it('detects Filipino / Tagalog document and returns tag "ph"', () => {
      const text = `
# Talaan ng mga Ideya sa Proyekto

Magandang araw sa lahat. Ito ang mga plano para sa ating proyekto sa komunidad.
Kailangan natin ng tulong mula sa mga kasamahan upang maisakatuparan ang mga layunin.
Salamat sa inyong suporta at pagtitiwala.
      `;
      const result = detectDocumentLanguage(text, 'Plano_ng_Proyekto.md');
      expect(result.primary).toBe('ph');
      expect(result.tags).toContain('ph');
    });

    it('detects bilingual Russian & English documents and includes both tags', () => {
      const text = `
# API Specification для проекта ArtMaze

The following REST API endpoints are designed for character synchronization.
Мы используем протокол WebSocket для отправки событий в реальном времени.
Authentication is handled via Bearer tokens. В случае ошибки возвращается код 401.
      `;
      const result = detectDocumentLanguage(text, 'ArtMaze_API.md');
      expect(result.tags).toContain('ru');
      expect(result.tags).toContain('en');
    });
  });

  describe('enforceTitleLanguage', () => {
    it('enforces Russian title for Russian document when LLM erroneously produced English title', () => {
      const docContent = `
# Межпланетный интернет

Архитектура протоколов передачи данных в глубоком космосе.
Задержки пакетов составляют от нескольких минут до часов.
      `;
      const originalFilename = 'Межпланетный интернет 7 первых запросов в бесконечном интернете.md';
      
      // LLM mistakenly output an English title
      const llmTitle = 'Interplanetary Internet Protocol';
      
      const fixedTitle = enforceTitleLanguage(llmTitle, docContent, originalFilename);
      expect(hasCyrillic(fixedTitle)).toBe(true);
      expect(fixedTitle).toBe('Межпланетный интернет');
    });

    it('preserves valid Russian title for Russian document', () => {
      const docContent = 'Заметка о настройке NGINX и баз данных.';
      const originalFilename = 'nginx_setup.md';
      const validRussianTitle = 'Настройка NGINX';

      const result = enforceTitleLanguage(validRussianTitle, docContent, originalFilename);
      expect(result).toBe('Настройка NGINX');
    });

    it('enforces English title for English document when LLM erroneously produced Russian title', () => {
      const docContent = `
# Server Memory Diagnostics

Monitoring pagefile.sys and swap usage when loading multiple LLMs simultaneously.
Ensure context size is bounded to 2048 tokens.
      `;
      const originalFilename = 'memory_diagnostics_report.md';
      const llmTitle = 'Диагностика Памяти Сервера';

      const fixedTitle = enforceTitleLanguage(llmTitle, docContent, originalFilename);
      expect(hasCyrillic(fixedTitle)).toBe(false);
      expect(fixedTitle).toBe('Server Memory Diagnostics');
    });

    it('preserves valid English title for English document', () => {
      const docContent = 'This is an overview of our project roadmap for Q3.';
      const originalFilename = 'Roadmap_Q3.md';
      const validEnglishTitle = 'Project Roadmap Q3';

      const result = enforceTitleLanguage(validEnglishTitle, docContent, originalFilename);
      expect(result).toBe('Project Roadmap Q3');
    });
  });

  describe('ensureLanguageTags', () => {
    it('prepends "ru" tag to Russian note tags if missing', () => {
      const docContent = 'Сценарий короткометражного фильма о космосе.';
      const existingTags = ['scenario', 'projects'];

      const result = ensureLanguageTags(existingTags, docContent, 'Script.md');
      expect(result).toContain('ru');
      expect(result[0]).toBe('ru');
      expect(result).toContain('scenario');
    });

    it('prepends "en" tag to English note tags if missing', () => {
      const docContent = 'Meeting notes about the quarterly budget and engineering milestones.';
      const existingTags = ['planning', 'finance'];

      const result = ensureLanguageTags(existingTags, docContent, 'Meeting.md');
      expect(result).toContain('en');
      expect(result[0]).toBe('en');
    });

    it('prepends "ph" tag to Tagalog note tags', () => {
      const docContent = 'Ito ang mga mahahalagang tala para sa ating mga kasamahan.';
      const existingTags = ['talaan'];

      const result = ensureLanguageTags(existingTags, docContent, 'Talaan.md');
      expect(result).toContain('ph');
    });

    it('does not duplicate language tags if already present', () => {
      const docContent = 'Текст на русском языке.';
      const existingTags = ['ru', 'исследования'];

      const result = ensureLanguageTags(existingTags, docContent, 'Note.md');
      const ruCount = result.filter(t => t.toLowerCase() === 'ru').length;
      expect(ruCount).toBe(1);
    });
  });
});
