#!/bin/sh
# Runs once, only when the postgres data directory is first initialized.
# Creates the separate database used by the backend test suite (see CLAUDE.md: no SQLite in tests).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
    CREATE DATABASE autoparts_test;
SQL
