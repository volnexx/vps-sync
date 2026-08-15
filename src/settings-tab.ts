import { App, PluginSettingTab, Setting } from "obsidian";
import { createSalt } from "./crypto";
import { exportSetupCode, importSetupCode } from "./setup-code";
import type VpsSyncPlugin from "./main";

export class VpsSyncSettingTab extends PluginSettingTab {
  private setupCode = "";

  constructor(app: App, private readonly plugin: VpsSyncPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    const settings = this.plugin.data.settings;
    containerEl.empty();
    containerEl.createEl("h2", { text: "VPS Sync" });
    containerEl.createEl("p", {
      text: "Синхронизирует заметки, вложения, папки, темы, CSS, расширения и их настройки. Все запросы выполняются строго последовательно."
    });

    new Setting(containerEl)
      .setName("Адрес CouchDB")
      .setDesc("Корневой адрес без имени базы. Например: https://sync.example.org")
      .addText((text) =>
        text.setPlaceholder("https://example.org").setValue(settings.serverUrl).onChange(async (value) => {
          settings.serverUrl = value.trim();
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("База данных")
      .setDesc("Для VPS Sync нужна отдельная база, не база Self-hosted LiveSync.")
      .addText((text) =>
        text.setValue(settings.database).onChange(async (value) => {
          settings.database = value.trim();
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl).setName("Пользователь CouchDB").addText((text) =>
      text.setValue(settings.username).onChange(async (value) => {
        settings.username = value;
        await this.plugin.savePluginData();
      })
    );

    new Setting(containerEl).setName("Пароль CouchDB").addText((text) => {
      text.inputEl.type = "password";
      text.setValue(settings.password).onChange(async (value) => {
        settings.password = value;
        await this.plugin.savePluginData();
      });
    });

    new Setting(containerEl)
      .setName("Пароль шифрования")
      .setDesc("Не менее 12 символов. Должен совпадать на всех устройствах.")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setValue(settings.encryptionPassphrase).onChange(async (value) => {
          settings.encryptionPassphrase = value;
          await this.plugin.savePluginData();
        });
      });

    new Setting(containerEl)
      .setName("Соль шифрования")
      .setDesc("Создаётся один раз и переносится кодом подключения.")
      .addText((text) => text.setValue(settings.encryptionSalt).setDisabled(true))
      .addButton((button) =>
        button.setButtonText("Создать новую").onClick(async () => {
          if (settings.initialised) {
            this.plugin.recordActivity("warning", "Нельзя менять соль после начала синхронизации: старые данные станут недоступны");
            await this.plugin.openPanel();
            return;
          }
          settings.encryptionSalt = createSalt();
          await this.plugin.savePluginData();
          this.display();
        })
      );

    new Setting(containerEl).setName("Название устройства").addText((text) =>
      text.setValue(settings.deviceName).onChange(async (value) => {
        settings.deviceName = value.trim() || "Устройство";
        await this.plugin.savePluginData();
      })
    );

    new Setting(containerEl)
      .setName("Период синхронизации")
      .setDesc("Секунды. Работает, пока Obsidian открыт; iOS не разрешает расширению работать после закрытия приложения.")
      .addText((text) =>
        text.setValue(String(settings.syncIntervalSeconds)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) settings.syncIntervalSeconds = Math.max(10, parsed);
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Предельный размер файла")
      .setDesc("Мегабайты. Более крупные файлы пропускаются и указываются в журнале.")
      .addText((text) =>
        text.setValue(String(settings.maxFileSizeMb)).onChange(async (value) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) settings.maxFileSizeMb = Math.max(1, parsed);
          await this.plugin.savePluginData();
        })
      );

    new Setting(containerEl)
      .setName("Дополнительные исключения")
      .setDesc("Один путь или шаблон на строку. Поддерживаются * и **.")
      .addTextArea((text) =>
        text.setValue(settings.extraExcludedPatterns.join("\n")).onChange(async (value) => {
          settings.extraExcludedPatterns = value
            .split("\n")
            .map((item) => item.trim())
            .filter(Boolean);
          await this.plugin.savePluginData();
        })
      );

    containerEl.createEl("h3", { text: "Перенос подключения на iPhone" });
    new Setting(containerEl)
      .setName("Код подключения")
      .setDesc("Содержит пароли. Не публикуйте и не храните его в заметках.")
      .addTextArea((text) =>
        text.setPlaceholder("Вставьте код на втором устройстве").onChange((value) => {
          this.setupCode = value;
        })
      )
      .addButton((button) =>
        button.setButtonText("Скопировать").onClick(async () => {
          try {
            await navigator.clipboard.writeText(exportSetupCode(settings));
            button.setButtonText("Скопировано");
            this.plugin.recordActivity("success", "Код подключения скопирован");
            window.setTimeout(() => button.setButtonText("Скопировать"), 1_500);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.recordActivity("error", `Не удалось скопировать код подключения: ${message}`);
            await this.plugin.openPanel();
          }
        })
      )
      .addButton((button) =>
        button.setButtonText("Применить").setCta().onClick(async () => {
          try {
            this.plugin.data.settings = importSetupCode(this.setupCode, settings);
            await this.plugin.savePluginData();
            this.plugin.recordActivity("success", "Подключение импортировано. Название и идентификатор устройства сохранены");
            this.display();
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.recordActivity("error", `Не удалось импортировать подключение: ${message}`);
            await this.plugin.openPanel();
          }
        })
      );

    containerEl.createEl("h3", { text: "Запуск" });
    new Setting(containerEl)
      .setName("Проверить подключение")
      .setDesc("Создаёт базу, если её ещё нет, но не переносит файлы.")
      .addButton((button) =>
        button.setButtonText("Проверить").onClick(async () => {
          await this.plugin.testConnection();
        })
      );

    new Setting(containerEl)
      .setName("Это основное устройство")
      .setDesc("Первый запуск на компьютере: локальные файлы имеют преимущество при совпадении путей.")
      .addButton((button) =>
        button.setButtonText("Отправить хранилище").setCta().onClick(async () => {
          await this.plugin.startInitialSync("prefer-local");
        })
      );

    new Setting(containerEl)
      .setName("Это новое устройство")
      .setDesc("Первый запуск на iPhone: серверные файлы имеют преимущество при совпадении путей.")
      .addButton((button) =>
        button.setButtonText("Получить хранилище").setCta().onClick(async () => {
          await this.plugin.startInitialSync("prefer-remote");
        })
      );

    new Setting(containerEl)
      .setName(settings.paused ? "Синхронизация приостановлена" : "Синхронизация включена")
      .addButton((button) =>
        button.setButtonText(settings.paused ? "Включить" : "Приостановить").onClick(async () => {
          await this.plugin.togglePaused();
          this.display();
        })
      );

    const lastErrors = this.plugin.data.state.lastErrors ?? [];
    const activityLog = this.plugin.data.state.activityLog ?? [];
    containerEl.createEl("h3", { text: "Диагностика" });
    containerEl.createEl("p", {
      text: "Сообщения VPS Sync находятся в боковой панели. Отчёт не содержит пароли, соль или код подключения."
    });

    new Setting(containerEl)
      .setName("Боковая панель")
      .setDesc("Текущее состояние, результаты синхронизации, ошибки и журнал сообщений.")
      .addButton((button) =>
        button.setButtonText("Открыть панель").setCta().onClick(async () => {
          await this.plugin.openPanel();
        })
      );

    new Setting(containerEl)
      .setName(`Ошибки последней синхронизации: ${lastErrors.length}`)
      .setDesc(lastErrors.length > 0 ? "Копирует точные пути и причины ошибок для отправки разработчику." : "Ошибок нет.")
      .addButton((button) => {
        button.setButtonText("Скопировать ошибки").setDisabled(lastErrors.length === 0).onClick(async () => {
          try {
            await this.plugin.copyErrors();
            button.setButtonText("Скопировано");
            window.setTimeout(() => button.setButtonText("Скопировать ошибки"), 1_500);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.recordActivity("error", `Не удалось скопировать ошибки: ${message}`);
            await this.plugin.openPanel();
          }
        });
      });

    new Setting(containerEl)
      .setName(`Журнал сообщений: ${activityLog.length}`)
      .setDesc("Копирует результаты проверок, синхронизаций и служебные сообщения VPS Sync.")
      .addButton((button) => {
        button.setButtonText("Скопировать журнал").setDisabled(activityLog.length === 0).onClick(async () => {
          try {
            await this.plugin.copyActivityLog();
            button.setButtonText("Скопировано");
            window.setTimeout(() => button.setButtonText("Скопировать журнал"), 1_500);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.plugin.recordActivity("error", `Не удалось скопировать журнал: ${message}`);
            await this.plugin.openPanel();
          }
        });
      });

    if (lastErrors.length > 0) {
      containerEl.createEl("h4", { text: "Последние ошибки" });
      containerEl.createEl("p", {
        text: "Указаны точные пути и причины последней неудачной синхронизации."
      });
      new Setting(containerEl)
        .setName("Журнал ошибок")
        .addTextArea((text) => {
          text.setValue(lastErrors.join("\n"));
          text.inputEl.readOnly = true;
          text.inputEl.rows = Math.min(14, Math.max(4, lastErrors.length));
        });
    }
  }
}
