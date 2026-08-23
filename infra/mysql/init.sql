CREATE USER IF NOT EXISTS 'cryptosignal'@'%' IDENTIFIED BY 'cryptosignal';
GRANT ALL PRIVILEGES ON cryptosignal.* TO 'cryptosignal'@'%';
FLUSH PRIVILEGES;
