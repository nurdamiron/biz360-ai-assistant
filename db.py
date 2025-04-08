import mysql.connector

# Подключение к MySQL
conn = mysql.connector.connect(
    host="biz360.czwiyugwum02.eu-north-1.rds.amazonaws.com",
    user="root",
    password="nurda0101",
    database="biz360_ai_assistant"
)
cursor = conn.cursor()

# Получение всех таблиц
cursor.execute("SHOW TABLES")
tables_raw = cursor.fetchall()

# Правильное преобразование имен таблиц из bytearray
tables = []
for row in tables_raw:
    if isinstance(row[0], bytes):
        tables.append(row[0].decode('utf-8'))
    else:
        tables.append(row[0])

# Создание текстового файла
output_file = "database_structure.txt"
with open(output_file, "w", encoding="utf-8") as f:
    f.write("СТРУКТУРА БАЗЫ ДАННЫХ\n")
    f.write("=" * 50 + "\n\n")
    
    for table in tables:
        try:
            f.write(f"ТАБЛИЦА: {table}\n")
            f.write("-" * 50 + "\n\n")
            
            # Получение структуры таблицы
            cursor.execute(f"DESCRIBE `{table}`")
            columns = cursor.fetchall()
            
            f.write("Колонки:\n")
            for column in columns:
                column_name = column[0].decode('utf-8') if isinstance(column[0], bytes) else column[0]
                column_type = column[1].decode('utf-8') if isinstance(column[1], bytes) else column[1]
                column_null = "NOT NULL" if column[2] == "NO" else "NULL"
                column_key = column[3].decode('utf-8') if isinstance(column[3], bytes) and column[3] else ""
                column_default = f"DEFAULT {column[4].decode('utf-8') if isinstance(column[4], bytes) else column[4]}" if column[4] is not None else ""
                column_extra = column[5].decode('utf-8') if isinstance(column[5], bytes) and column[5] else ""
                
                f.write(f"  {column_name} {column_type} {column_null} {column_key} {column_default} {column_extra}\n")
            
            f.write("\n")
            
            # Получение внешних ключей
            cursor.execute(f"""
                SELECT COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
                FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_NAME = '{table}' AND TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
            """)
            foreign_keys = cursor.fetchall()
            
            if foreign_keys:
                f.write("Внешние ключи:\n")
                for fk in foreign_keys:
                    col_name = fk[0].decode('utf-8') if isinstance(fk[0], bytes) else fk[0]
                    constraint = fk[1].decode('utf-8') if isinstance(fk[1], bytes) else fk[1]
                    ref_table = fk[2].decode('utf-8') if isinstance(fk[2], bytes) else fk[2]
                    ref_col = fk[3].decode('utf-8') if isinstance(fk[3], bytes) else fk[3]
                    f.write(f"  {constraint}: {table}.{col_name} -> {ref_table}.{ref_col}\n")
                
                f.write("\n")
            
            # Получение индексов
            cursor.execute(f"SHOW INDEX FROM `{table}`")
            indexes = cursor.fetchall()
            
            if indexes:
                # Группировка индексов по имени
                index_groups = {}
                for index in indexes:
                    index_name = index[2].decode('utf-8') if isinstance(index[2], bytes) else index[2]
                    if index_name not in index_groups:
                        index_groups[index_name] = []
                    index_groups[index_name].append(index)
                
                f.write("Индексы:\n")
                for index_name, index_columns in index_groups.items():
                    is_unique = "UNIQUE" if not bool(index_columns[0][1]) else ""
                    columns = []
                    for idx in index_columns:
                        col = idx[4].decode('utf-8') if isinstance(idx[4], bytes) else idx[4]
                        columns.append(col)
                    cols_str = ", ".join(columns)
                    f.write(f"  {index_name} {is_unique}: ({cols_str})\n")
                
                f.write("\n")
            
            # Получение CREATE TABLE
            cursor.execute(f"SHOW CREATE TABLE `{table}`")
            create_result = cursor.fetchone()
            create_table_sql = create_result[1].decode('utf-8') if isinstance(create_result[1], bytes) else create_result[1]
            f.write("SQL создания таблицы:\n")
            f.write(f"{create_table_sql};\n\n")
            
            f.write("=" * 50 + "\n\n")
        except mysql.connector.Error as err:
            f.write(f"Ошибка при обработке таблицы {table}: {err}\n\n")
            f.write("=" * 50 + "\n\n")
            continue

print(f"Файл {output_file} успешно создан!")

# Закрытие соединения
cursor.close()
conn.close()