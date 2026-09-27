# Установка Qoima на сервер

Пошаговая инструкция для чистого сервера Ubuntu 24.04. Команды готовы к копированию.
Где нужно подставить своё значение, оно написано ЗАГЛАВНЫМИ буквами:

- `SERVER_IP` — IP-адрес сервера;
- `qoima.example.kz` — домен сайта;
- `Имя Фамилия` — имя владельца для интерфейса.

Что получится: на сервере в Docker работают три контейнера — `db` (PostgreSQL 17, порт наружу
не открыт), `api` (FastAPI) и `web` (Caddy: HTTPS-сертификат, статика фронтенда, `/api/*` на api).
Каждую ночь в 03:00 делается зашифрованный бэкап базы, компьютер владельца забирает его к себе.

Команды помечены, где их выполнять:

- **[владелец]** — на компьютере владельца (Linux, macOS или WSL в Windows);
- **[сервер, root]** — на сервере под root (только в разделе 1);
- **[сервер]** — на сервере под пользователем `deploy`.

## 0. Что нужно заранее

1. Сервер (VPS) с Ubuntu 24.04, от 1 ГБ памяти и 20 ГБ диска. Доступ root по SSH-ключу или паролю
   от хостинга.
2. Домен. У регистратора создайте A-запись `qoima.example.kz` → `SERVER_IP`.
   Проверка (должен вывести IP сервера):

   ```bash
   # [владелец]
   dig +short qoima.example.kz
   ```

3. SSH-ключ на компьютере владельца. Если его нет (`ls ~/.ssh/id_ed25519.pub` пишет «No such file»):

   ```bash
   # [владелец]
   ssh-keygen -t ed25519 -C "qoima-owner"
   ```

## 1. Пользователь с sudo и вход по ключу

```bash
# [владелец] войти под root (пароль или ключ от хостинга)
ssh root@SERVER_IP
```

```bash
# [сервер, root] пользователь deploy с правом sudo
adduser --gecos "" deploy
usermod -aG sudo deploy
```

`adduser` спросит пароль: он нужен для `sudo`, по SSH с паролем войти будет нельзя.

```bash
# [владелец] в новом терминале: скопировать свой ключ пользователю deploy
ssh-copy-id deploy@SERVER_IP
```

Проверьте, что вход по ключу работает, **не закрывая** сессию root:

```bash
# [владелец]
ssh deploy@SERVER_IP 'sudo -v && echo OK'
```

Запрет входа под root и по паролю. Файл называется `00-...`, потому что sshd берёт первое
найденное значение, а в облачных образах бывает `50-cloud-init.conf` с `PasswordAuthentication yes`.

```bash
# [сервер]
sudo tee /etc/ssh/sshd_config.d/00-qoima-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
EOF
sudo sshd -t && sudo systemctl restart ssh
```

Проверка из нового терминала (оба входа должны быть отклонены, вход `deploy` по ключу работает):

```bash
# [владелец]
ssh -o PubkeyAuthentication=no deploy@SERVER_IP   # Permission denied (publickey)
ssh root@SERVER_IP                                 # Permission denied (publickey)
ssh deploy@SERVER_IP 'echo OK'                     # OK
```

Дальше все команды на сервере выполняются под `deploy`: `ssh deploy@SERVER_IP`.

## 2. Обновления, часовой пояс, базовые пакеты

```bash
# [сервер]
sudo apt update && sudo apt -y full-upgrade
sudo timedatectl set-timezone Asia/Almaty
sudo apt install -y git age ufw fail2ban python3-systemd unattended-upgrades
```

Часовой пояс нужен, чтобы cron запускал бэкап в 03:00 по Алматы и имена бэкапов были в местном
времени. Если после `full-upgrade` появился файл `/var/run/reboot-required`, перезагрузите
сервер: `sudo reboot`.

## 3. Firewall (ufw)

```bash
# [сервер]
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw --force enable
sudo ufw status verbose
```

`443/udp` — HTTP/3. Важно: порты, опубликованные Docker, работают в обход ufw. Поэтому в
`docker-compose.prod.yml` наружу опубликованы только 80 и 443 у Caddy; база и api доступны
только внутри сети Docker.

## 4. fail2ban (блокировка подбора пароля по SSH)

```bash
# [сервер]
sudo tee /etc/fail2ban/jail.local >/dev/null <<'EOF'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
EOF
sudo systemctl enable --now fail2ban
sudo systemctl restart fail2ban
sudo fail2ban-client status sshd
```

## 5. Автоматические обновления безопасности

```bash
# [сервер]
sudo tee /etc/apt/apt.conf.d/20auto-upgrades >/dev/null <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
sudo systemctl enable --now unattended-upgrades
sudo unattended-upgrade --dry-run --debug 2>&1 | tail -n 5
```

Автоматическую перезагрузку не включаем: после обновления ядра перезагрузите сервер сами в
удобное время (контейнеры поднимутся сами, у них `restart: unless-stopped`).

## 6. Docker из официального репозитория

```bash
# [сервер]
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker deploy
```

Выйдите и войдите заново (`exit`, затем `ssh deploy@SERVER_IP`), чтобы группа `docker`
применилась. Проверка:

```bash
# [сервер]
docker run --rm hello-world
docker compose version
```

## 7. Клонирование репозитория (deploy key только на чтение)

Отдельный ключ сервера, который может только читать этот репозиторий:

```bash
# [сервер]
ssh-keygen -t ed25519 -f ~/.ssh/qoima_deploy -N "" -C "qoima-server"
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/qoima_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
cat ~/.ssh/qoima_deploy.pub
```

На GitHub: репозиторий → **Settings → Deploy keys → Add deploy key**, вставьте выведенную
строку, галочку **Allow write access НЕ ставьте**. Затем:

```bash
# [сервер]
ssh -T git@github.com    # "Hi Alpi157/qoima! You've successfully authenticated..."
git clone git@github.com:Alpi157/qoima.git ~/qoima
```

## 8. Настройки (.env.prod)

```bash
# [сервер]
cd ~/qoima
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod
PW="$(openssl rand -hex 24)" && sed -i "s/change-me/$PW/g" deploy/.env.prod && unset PW
sed -i "s/^DOMAIN=.*/DOMAIN=qoima.example.kz/" deploy/.env.prod
cat deploy/.env.prod
```

Пароль базы подставлен в двух местах (`POSTGRES_PASSWORD` и `DATABASE_URL`), домен — в `DOMAIN`.
Файл не попадает в git. Пароль базы меняйте только до первого запуска: потом PostgreSQL его
уже запомнил в volume.

## 9. Первый запуск

```bash
# [сервер]
cd ~/qoima
docker compose -f deploy/docker-compose.prod.yml up -d --build --wait
docker compose -f deploy/docker-compose.prod.yml ps
curl -fsS https://qoima.example.kz/api/health
```

Ожидается `{"status":"ok","db":"ok"}`. Первая сборка занимает несколько минут. Миграции
применяются автоматически при каждом старте `api`. Сертификат Let's Encrypt Caddy получает сам
(нужны DNS из раздела 0 и открытые 80/443); если `curl` ругается на сертификат, смотрите
`docker compose -f deploy/docker-compose.prod.yml logs web`.

## 10. Пользователь и настройки продавца

```bash
# [сервер]
cd ~/qoima
docker compose -f deploy/docker-compose.prod.yml exec api python -m app.cli create-user --username owner --full-name "Имя Фамилия"
```

Пароль спросит дважды. Сменить позже:
`docker compose -f deploy/docker-compose.prod.yml exec api python -m app.cli set-password --username owner`.

Откройте `https://qoima.example.kz`, войдите и заполните **Настройки** — данные продавца для
накладной З-2: организация (ИП), ИИН/БИН, ответственный за поставку, «Отпустил», главный
бухгалтер. Без них эти поля в накладной останутся пустыми.

## 11. Бэкапы

Бэкап шифруется **открытым** ключом age. Приватный ключ хранится только у владельца: даже если
сервер взломают, бэкапы прочитать не смогут.

### 11.1 Ключ шифрования

```bash
# [владелец] установить age: Ubuntu/WSL — sudo apt install -y age; macOS — brew install age
age-keygen -o ~/qoima-backup-key.txt
chmod 600 ~/qoima-backup-key.txt
```

**Сохраните `~/qoima-backup-key.txt` ещё в двух местах** (менеджер паролей и флешка/бумага).
Без этого файла ни один бэкап восстановить нельзя.

Отправить на сервер только открытый ключ:

```bash
# [владелец]
age-keygen -y ~/qoima-backup-key.txt | ssh deploy@SERVER_IP 'sudo mkdir -p /etc/qoima && sudo tee /etc/qoima/backup.pub'
```

### 11.2 Каталог и первый бэкап вручную

```bash
# [сервер]
sudo install -d -m 700 -o deploy -g deploy /var/backups/qoima
AGE_RECIPIENTS_FILE=/etc/qoima/backup.pub bash ~/qoima/deploy/backup.sh
ls -lh /var/backups/qoima
```

Ожидается строка `OK: qoima-ГГГГ-ММ-ДД_ЧЧММСС.dump.age, …`. Скрипт хранит бэкапы 14 дней,
старые удаляет сам. При любой ошибке он пишет `ОШИБКА: …` и завершается с ненулевым кодом.

### 11.3 Каждую ночь в 03:00 (cron)

```bash
# [сервер]
(crontab -l 2>/dev/null; echo '0 3 * * * AGE_RECIPIENTS_FILE=/etc/qoima/backup.pub /bin/bash /home/deploy/qoima/deploy/backup.sh >> /home/deploy/qoima-backup.log 2>&1') | crontab -
crontab -l
```

Утром проверить: `tail -n 5 ~/qoima-backup.log`.

### 11.4 Копия бэкапов у владельца

`pull-backups.sh` запускается на компьютере владельца и забирает новые файлы через rsync по SSH.
Локальные копии не удаляются (хранятся дольше 14 дней).

```bash
# [владелец] один раз: взять скрипт из репозитория
mkdir -p ~/bin
scp deploy@SERVER_IP:qoima/deploy/pull-backups.sh ~/bin/
chmod +x ~/bin/pull-backups.sh

# забрать бэкапы (вручную или по расписанию)
QOIMA_SERVER=deploy@SERVER_IP ~/bin/pull-backups.sh
```

По расписанию, например каждый день в 10:00 (компьютер ночью может быть выключен):

```bash
# [владелец] на Linux/WSL/macOS
(crontab -l 2>/dev/null; echo "0 10 * * * QOIMA_SERVER=deploy@SERVER_IP $HOME/bin/pull-backups.sh >> $HOME/qoima-pull.log 2>&1") | crontab -
```

### 11.5 Проверка восстановления (раз в месяц)

Расшифровка идёт на компьютере владельца, на сервер уходит уже расшифрованный поток — приватный
ключ на сервер не попадает. Дамп восстанавливается в отдельную базу `qoima_restore_check`,
основная база не трогается:

```bash
# [владелец]
LATEST="$(ls -1 ~/qoima-backups/qoima-*.dump.age | sort | tail -n 1)"
age -d -i ~/qoima-backup-key.txt "$LATEST" | ssh deploy@SERVER_IP 'bash ~/qoima/deploy/restore.sh -'
```

Скрипт выведет таблицу строк в `qoima_restore_check` и в основной базе. Отличия нормальны,
если после бэкапа в системе что-то проводили.

### 11.6 Восстановление основной базы (авария)

Заменяет основную базу содержимым бэкапа. Всё, что внесено после бэкапа, пропадёт.

```bash
# [владелец] расшифровать и отправить на сервер
age -d -i ~/qoima-backup-key.txt ~/qoima-backups/qoima-ГГГГ-ММ-ДД_ЧЧММСС.dump.age > /tmp/qoima.dump
scp /tmp/qoima.dump deploy@SERVER_IP:/tmp/qoima.dump
rm /tmp/qoima.dump
ssh -t deploy@SERVER_IP 'bash ~/qoima/deploy/restore.sh --into-main /tmp/qoima.dump; shred -u /tmp/qoima.dump'
```

Скрипт попросит ввести имя базы (`qoima`) для подтверждения, остановит `api`, восстановит базу
одной транзакцией (при ошибке база не меняется) и запустит `api` обратно.

## 12. Обновление версии

```bash
# [сервер]
cd ~/qoima
AGE_RECIPIENTS_FILE=/etc/qoima/backup.pub bash deploy/backup.sh
git pull
docker compose -f deploy/docker-compose.prod.yml up -d --build --wait
docker compose -f deploy/docker-compose.prod.yml ps
curl -fsS https://qoima.example.kz/api/health
docker image prune -f
```

Бэкап перед обновлением — на случай неудачной миграции. Миграции применяются при старте `api`.
Если что-то пошло не так: `git log --oneline -5`, `git checkout <предыдущий коммит>` и снова
`up -d --build --wait` (схема базы назад сама не откатывается — тогда восстановление из бэкапа,
раздел 11.6).

## 13. Логи

```bash
# [сервер]
cd ~/qoima
docker compose -f deploy/docker-compose.prod.yml logs --tail 100 api
docker compose -f deploy/docker-compose.prod.yml logs -f web          # Ctrl+C для выхода
docker compose -f deploy/docker-compose.prod.yml logs --since 1h db
tail -n 20 ~/qoima-backup.log
```

Логи контейнеров ограничены: до 3 файлов по 10 МБ на контейнер.

## 14. Внешний мониторинг

Заведите бесплатную проверку в UptimeRobot, Better Stack или аналоге:

- тип HTTP(s), адрес `https://qoima.example.kz/api/health`, интервал 5 минут;
- успех — код 200 (`{"status":"ok","db":"ok"}`); 503 значит, что недоступна база;
- уведомления на e-mail или в Telegram.

`/api/health` отвечает и на GET, и на HEAD, авторизация не нужна. Срок сертификата такой
монитор тоже проверяет; Caddy продлевает его сам.

## 15. Проверка безопасности после установки

```bash
# [владелец]
curl -sI https://qoima.example.kz/ | grep -iE "strict-transport|content-security|x-frame|server"
curl -s -o /dev/null -w "%{http_code}\n" https://qoima.example.kz/docs            # 200: это страница фронтенда
curl -s -w "\n%{http_code}\n" https://qoima.example.kz/api/openapi.json          # 404: документация API выключена
nc -zv -w 3 SERVER_IP 5432; nc -zv -w 3 SERVER_IP 8000                           # оба: refused/timeout
```

Заголовка `Server` в ответе быть не должно, база (5432) и api (8000) снаружи недоступны.
