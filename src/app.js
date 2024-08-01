import express from "express";
import sql from "mssql";
import winston from "winston";
import cors from "cors";

const app = express();
const port = process.env.PORT || 3000;
app.use(cors());

// Configuración de Winston para logs personalizados
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/auditorias.log" }),
  ],
});

// * localhost:3000/api/auditoria/1?user=sa&password=L23456o!&database=pubs

// * 1. Chequeo de anomalias en datos huerfanos
app.get("/api/auditoria/1", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      -- Crear una tabla temporal para almacenar los resultados
      IF OBJECT_ID('tempdb..#OrphanRecords') IS NOT NULL
          DROP TABLE #OrphanRecords;

      CREATE TABLE #OrphanRecords (
          TableName NVARCHAR(128),
          OrphanCount INT
      );

      -- Insertar registros hu�rfanos en la tabla temporal
      -- Se construyen y ejecutan consultas para detectar registros hu�rfanos
      DECLARE @tableName NVARCHAR(128);
      DECLARE @referencedTableName NVARCHAR(128);
      DECLARE @parentColumnName NVARCHAR(128);
      DECLARE @referencedColumnName NVARCHAR(128);
      DECLARE @sql NVARCHAR(MAX);

      -- Buscar tablas con claves for�neas
      DECLARE cur CURSOR FOR
      SELECT 
          t.name AS TableName,
          rt.name AS ReferencedTableName,
          c.name AS ParentColumnName,
          rc.name AS ReferencedColumnName
      FROM 
          sys.foreign_key_columns AS fkc
      INNER JOIN 
          sys.tables AS t ON fkc.parent_object_id = t.object_id
      INNER JOIN 
          sys.tables AS rt ON fkc.referenced_object_id = rt.object_id
      INNER JOIN 
          sys.columns AS c ON fkc.parent_column_id = c.column_id AND fkc.parent_object_id = c.object_id
      INNER JOIN 
          sys.columns AS rc ON fkc.referenced_column_id = rc.column_id AND fkc.referenced_object_id = rc.object_id;

      OPEN cur;

      FETCH NEXT FROM cur INTO @tableName, @referencedTableName, @parentColumnName, @referencedColumnName;

      WHILE @@FETCH_STATUS = 0
      BEGIN
          -- Construir y ejecutar consulta para detectar registros hu�rfanos
          SET @sql = '
          INSERT INTO #OrphanRecords (TableName, OrphanCount)
          SELECT ''' + @tableName + ''' AS TableName, 
                COUNT(*) AS OrphanCount
          FROM ' + QUOTENAME(@tableName) + ' AS pt
          WHERE NOT EXISTS 
              (SELECT 1 
              FROM ' + QUOTENAME(@referencedTableName) + ' AS rt 
              WHERE pt.' + QUOTENAME(@parentColumnName) + ' = rt.' + QUOTENAME(@referencedColumnName) + ');';
          
          EXEC sp_executesql @sql;
          
          FETCH NEXT FROM cur INTO @tableName, @referencedTableName, @parentColumnName, @referencedColumnName;
      END

      CLOSE cur;
      DEALLOCATE cur;

      -- Mostrar los resultados
      SELECT * FROM #OrphanRecords;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en datos huerfanos: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message: "Chequeo de anomalias en datos huerfanos",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 2. Chequeo de anomalias en datos - valores repetidos

app.get("/api/auditoria/2", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      -- Declara variables para almacenar la consulta din�mica
      DECLARE @sql NVARCHAR(MAX) = '';
      DECLARE @tableName NVARCHAR(128);
      DECLARE @columnList NVARCHAR(MAX);

      -- Tabla temporal para almacenar los resultados
      IF OBJECT_ID('tempdb..#Duplicates') IS NOT NULL
          DROP TABLE #Duplicates;

      CREATE TABLE #Duplicates (
          TableName NVARCHAR(128),
          DuplicateCount INT
      );

      -- Cursor para recorrer todas las tablas
      DECLARE table_cursor CURSOR FOR
      SELECT t.name
      FROM sys.tables AS t
      WHERE t.is_ms_shipped = 0;

      OPEN table_cursor;

      FETCH NEXT FROM table_cursor INTO @tableName;

      WHILE @@FETCH_STATUS = 0
      BEGIN
          -- Inicializa la lista de columnas
          SET @columnList = '';

          -- Obtiene las columnas de la tabla actual
          SELECT @columnList = STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY c.column_id)
          FROM sys.columns AS c
          WHERE c.object_id = OBJECT_ID(@tableName)
          AND c.system_type_id NOT IN (34, 35, 99); -- Excluye columnas con tipos de datos text, ntext, image

          -- Construye la consulta din�mica para contar filas duplicadas
          SET @sql = '
          INSERT INTO #Duplicates (TableName, DuplicateCount)
          SELECT
              ''' + @tableName + ''' AS TableName,
              COUNT(*) AS DuplicateCount
          FROM (
              SELECT
                  ' + @columnList + '
              FROM ' + @tableName + '
              GROUP BY ' + @columnList + '
              HAVING COUNT(*) > 1
          ) AS DuplicateGroups
          GROUP BY ' + @columnList + '
          HAVING COUNT(*) > 0;';

          -- Ejecuta la consulta din�mica
          EXEC sp_executesql @sql;

          FETCH NEXT FROM table_cursor INTO @tableName;
      END

      CLOSE table_cursor;
      DEALLOCATE table_cursor;

      -- Muestra los resultados almacenados en la tabla temporal
      SELECT * FROM #Duplicates;

      -- Limpia la tabla temporal
      DROP TABLE #Duplicates;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en datos - valores repetidos: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message: "Chequeo de anomalias en datos - valores repetidos",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 3. Chequeo de anomalias en datos - cumplir fk

app.get("/api/auditoria/3", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      DECLARE @constraintName NVARCHAR(128);
      DECLARE @sql NVARCHAR(MAX);

      DECLARE cur CURSOR FOR
      SELECT 
          fk.name AS ConstraintName
      FROM 
          sys.foreign_keys AS fk
      ORDER BY 
          fk.name;

      OPEN cur;

      FETCH NEXT FROM cur INTO @constraintName;

      WHILE @@FETCH_STATUS = 0
      BEGIN
          SET @sql = 'DBCC CHECKCONSTRAINTS (''' + @constraintName + ''');';
          
          EXEC sp_executesql @sql;
          
          FETCH NEXT FROM cur INTO @constraintName;
      END;

      CLOSE cur;
      DEALLOCATE cur;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en datos - cumplir fk: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message: "Chequeo de anomalias en datos - cumplir fk",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 4. Chequeo de anomalias en la definicion de la integridad referencial para eliminacion y actualizacion

app.get("/api/auditoria/4", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT 
          fk.name AS ForeignKeyName,
          tp.name AS ParentTable,
          tr.name AS ReferencedTable,
          fk.delete_referential_action_desc AS DeleteAction,
          fk.update_referential_action_desc AS UpdateAction
      FROM 
          sys.foreign_keys AS fk
      INNER JOIN 
          sys.tables AS tp ON fk.parent_object_id = tp.object_id
      INNER JOIN 
          sys.tables AS tr ON fk.referenced_object_id = tr.object_id
      WHERE 
          fk.delete_referential_action_desc NOT IN ('CASCADE', 'NO_ACTION')
          OR fk.update_referential_action_desc NOT IN ('CASCADE', 'NO_ACTION')
      ORDER BY 
          tp.name, tr.name;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en la definicion de la integridad referencial para eliminacion y actualizacion: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message:
        "Chequeo de anomalias en la definicion de la integridad referencial para eliminacion y actualizacion",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 5. Chequeo de anomalias en la definicion de la integridad referencial para insercion

app.get("/api/auditoria/5", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT 
          fk.name AS ForeignKeyName,
          tp.name AS ParentTable,
          tr.name AS ReferencedTable,
          pc.name AS ParentColumn,
          pc.is_nullable AS IsNullable
      FROM 
          sys.foreign_keys AS fk
      INNER JOIN 
          sys.tables AS tp ON fk.parent_object_id = tp.object_id
      INNER JOIN 
          sys.tables AS tr ON fk.referenced_object_id = tr.object_id
      INNER JOIN 
          sys.foreign_key_columns AS fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN 
          sys.columns AS pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
      WHERE 
          pc.is_nullable = 1
      ORDER BY 
          tp.name, tr.name;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en la definicion de la integridad referencial para insercion: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message:
        "Chequeo de anomalias en la definicion de la integridad referencial para insercion",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 6. Chequeo de anomalias en la definicion de PK

app.get("/api/auditoria/6", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      -- Declara una variable para almacenar el nombre de la tabla
      DECLARE @tableName NVARCHAR(128);

      -- Tabla temporal para almacenar los resultados
      IF OBJECT_ID('tempdb..#TablePrimaryKeys') IS NOT NULL
          DROP TABLE #TablePrimaryKeys;

      CREATE TABLE #TablePrimaryKeys (
          TableName NVARCHAR(128),
          HasPrimaryKey BIT
      );

      -- Cursor para recorrer todas las tablas
      DECLARE table_cursor CURSOR FOR
      SELECT t.name
      FROM sys.tables AS t
      WHERE t.is_ms_shipped = 0;

      OPEN table_cursor;

      FETCH NEXT FROM table_cursor INTO @tableName;

      WHILE @@FETCH_STATUS = 0
      BEGIN
          -- Verifica si la tabla tiene una clave primaria
          IF EXISTS (
              SELECT 1
              FROM sys.indexes AS i
              WHERE i.object_id = OBJECT_ID(@tableName)
              AND i.is_primary_key = 1
          )
          BEGIN
              -- Inserta un registro indicando que la tabla tiene clave primaria
              INSERT INTO #TablePrimaryKeys (TableName, HasPrimaryKey)
              VALUES (@tableName, 1);
          END
          ELSE
          BEGIN
              -- Inserta un registro indicando que la tabla no tiene clave primaria
              INSERT INTO #TablePrimaryKeys (TableName, HasPrimaryKey)
              VALUES (@tableName, 0);
          END

          FETCH NEXT FROM table_cursor INTO @tableName;
      END

      CLOSE table_cursor;
      DEALLOCATE table_cursor;

      -- Muestra solo las tablas que no tienen clave primaria con una columna que indica "No Primary Key"
      SELECT TableName, 'No Primary Key' AS PrimaryKeyStatus
      FROM #TablePrimaryKeys
      WHERE HasPrimaryKey = 0;

      -- Limpia la tabla temporal
      DROP TABLE #TablePrimaryKeys;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Chequeo de anomalias en la definicion de PK: ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message: "Chequeo de anomalias en la definicion de PK",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 7. Posibles relaciones que existen (Triggers)

app.get("/api/auditoria/7", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT 
          tr.name AS TriggerName,
          tp.name AS ParentTable,
          OBJECT_NAME(tr.parent_id) AS TableName,
          m.definition AS TriggerDefinition
      FROM 
          sys.triggers AS tr
      INNER JOIN 
          sys.tables AS tp ON tr.parent_id = tp.object_id
      INNER JOIN 
          sys.sql_modules AS m ON tr.object_id = m.object_id
      WHERE 
          tr.is_ms_shipped = 0
          AND (m.definition LIKE '%INSERT%' OR m.definition LIKE '%DELETE%' OR m.definition LIKE '%UPDATE%')
      ORDER BY 
          tp.name, tr.name;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Posibles relaciones que existen (Triggers): ${JSON.stringify(
        result.recordset
      )}`
    );
    res.json({
      message: "Posibles relaciones que existen (Triggers)",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 8. Relaciones que deberian existir

app.get("/api/auditoria/8", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT 
          tp.name AS ParentTable,
          cp.name AS ParentColumn,
          'PotentialReferencedTable' = REPLACE(cp.name, '_id', '')
      FROM 
          sys.columns AS cp
      INNER JOIN 
          sys.tables AS tp ON cp.object_id = tp.object_id
      LEFT JOIN 
          sys.foreign_key_columns AS fkc ON cp.column_id = fkc.parent_column_id AND cp.object_id = fkc.parent_object_id
      LEFT JOIN 
          sys.index_columns AS ic ON cp.column_id = ic.column_id AND tp.object_id = ic.object_id
      LEFT JOIN 
          sys.indexes AS i ON ic.object_id = i.object_id AND ic.index_id = i.index_id
      WHERE 
          cp.name LIKE '%_id' 
          AND fkc.constraint_object_id IS NULL
          AND (i.is_primary_key IS NULL OR i.is_primary_key = 0)
      ORDER BY 
          tp.name, cp.name;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Relaciones que deberian existir: ${JSON.stringify(result.recordset)}`
    );
    res.json({
      message: "Relaciones que deberian existir",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

// * 9. Relaciones que existen (FK)

app.get("/api/auditoria/9", async (req, res) => {
  const { user, password, database } = req.query;

  if (!user || !password || !database) {
    return res.status(400).json({
      message: "Missing parameters",
    });
  }

  const config = {
    user,
    password,
    server: "localhost",
    database,
    options: {
      encrypt: true,
      trustServerCertificate: true,
    },
  };

  try {
    const pool = await sql.connect(config);

    const query = `
      SELECT 
          fk.name AS ForeignKeyName,
          tp.name AS ParentTable,
          cp.name AS ParentColumn,
          tr.name AS ReferencedTable,
          cr.name AS ReferencedColumn
      FROM 
          sys.foreign_keys AS fk
      INNER JOIN 
          sys.foreign_key_columns AS fkc ON fk.object_id = fkc.constraint_object_id
      INNER JOIN 
          sys.tables AS tp ON fk.parent_object_id = tp.object_id
      INNER JOIN 
          sys.columns AS cp ON fkc.parent_column_id = cp.column_id AND tp.object_id = cp.object_id
      INNER JOIN 
          sys.tables AS tr ON fk.referenced_object_id = tr.object_id
      INNER JOIN 
          sys.columns AS cr ON fkc.referenced_column_id = cr.column_id AND tr.object_id = cr.object_id
      ORDER BY 
          tp.name, tr.name;
    `;

    const result = await pool.request().query(query);
    logger.info(
      `Relaciones que existen (FK): ${JSON.stringify(result.recordset)}`
    );
    res.json({
      message: "Relaciones que existen (FK)",
      result: result.recordset,
    });
  } catch (error) {
    logger.error(`Error querying the database: ${error}`);
    return res.status(500).json({
      message: "Error querying the database",
    });
  } finally {
    sql.close(); // Cerrar la conexión al final
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
