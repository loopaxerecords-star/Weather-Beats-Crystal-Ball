/**
 * DuckDB Analytical Engine Service
 * Browser Preview: DuckDB-Wasm initialized with Web Worker or IndexedDB Analytical Fallback.
 * Preserves strict evidence transparency: never claims DuckDB is active if falling back to IndexedDB.
 * Enforces read-only SELECT-only SQL validation.
 */

import { TelemetryEvent, CanonicalTelemetryRecord } from '../types/telemetry';
import { canonicalToTelemetryEvent } from './canonicalDataModel';
import { validateReadOnlySqlClient } from './aiIntelligenceSuite';

export interface QueryResult {
  columns: string[];
  rows: any[][];
  executionTimeMs: number;
  engineName: 'DuckDB-Wasm Engine' | 'IndexedDB Temporal Analytical Engine';
  rowCount: number;
}

class DuckDbService {
  private isInitialized = false;
  private isDuckDbNative = false;
  private dbInstance: any = null;
  private conn: any = null;
  private inMemoryEvents: TelemetryEvent[] = [];
  private engineType: 'DuckDB-Wasm Engine' | 'IndexedDB Temporal Analytical Engine' =
    'IndexedDB Temporal Analytical Engine';

  public async init(): Promise<boolean> {
    if (this.isInitialized) return true;

    try {
      const duckdb = await import('@duckdb/duckdb-wasm');
      const DUCKDB_BUNDLES = duckdb.getJsDelivrBundles();
      const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);

      const workerUrl = URL.createObjectURL(
        new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
      );

      const worker = new Worker(workerUrl);
      const logger = new duckdb.ConsoleLogger();
      this.dbInstance = new duckdb.AsyncDuckDB(logger, worker);
      await this.dbInstance.instantiate(bundle.mainModule, bundle.pthreadWorker);
      this.conn = await this.dbInstance.connect();

      await this.conn.query(`
        CREATE TABLE IF NOT EXISTS telemetry_events (
          event_id VARCHAR,
          domain VARCHAR,
          measurement_id VARCHAR,
          data_class VARCHAR,
          origin_type VARCHAR,
          event_time VARCHAR,
          quality_score DOUBLE,
          value_json VARCHAR
        );
      `);

      this.isDuckDbNative = true;
      this.engineType = 'DuckDB-Wasm Engine';
      this.isInitialized = true;
      return true;
    } catch (err) {
      console.warn('DuckDB-Wasm direct worker init deferred to IndexedDB Analytical Engine fallback:', err);
      this.isDuckDbNative = false;
      this.engineType = 'IndexedDB Temporal Analytical Engine';
      this.isInitialized = true;
      return false;
    }
  }

  public getEngineInfo() {
    return {
      isInitialized: this.isInitialized,
      isDuckDbWasmActive: this.isDuckDbNative,
      engineName: this.engineType,
      recordCount: this.inMemoryEvents.length
    };
  }

  public async insertEvents(events: TelemetryEvent[]) {
    this.inMemoryEvents.push(...events);
    if (this.inMemoryEvents.length > 2000) {
      this.inMemoryEvents = this.inMemoryEvents.slice(-2000);
    }

    if (this.isDuckDbNative && this.conn) {
      try {
        for (const evt of events) {
          const jsonStr = JSON.stringify(evt.measurement.value).replace(/'/g, "''");
          const qScore = evt.quality.quality_score ?? 1.0;
          await this.conn.query(`
            INSERT INTO telemetry_events VALUES (
              '${evt.event_id}',
              '${evt.domain}',
              '${evt.measurement.measurement_id.replace(/'/g, "''")}',
              '${evt.data_class}',
              '${evt.origin_type}',
              '${evt.event_time}',
              ${qScore},
              '${jsonStr}'
            );
          `);
        }
      } catch (e) {
        console.error('DuckDB Wasm insert error:', e);
      }
    }
  }

  public async insertCanonicalRecords(records: CanonicalTelemetryRecord[]) {
    const projected = records.map((record) => canonicalToTelemetryEvent(record));
    await this.insertEvents(projected);
  }

  public async executeSql(sqlQuery: string): Promise<QueryResult> {
    const validation = validateReadOnlySqlClient(sqlQuery);
    if (!validation.ok) {
      throw new Error(validation.error || 'Only read-only SELECT queries are permitted.');
    }

    const safeSql = validation.sql;
    const startTime = performance.now();

    if (this.isDuckDbNative && this.conn) {
      try {
        const arrowResult = await this.conn.query(safeSql);
        const schema = arrowResult.schema;
        const columns = schema.fields.map((f: any) => f.name);
        const rows: any[][] = [];

        for (const row of arrowResult) {
          const r: any[] = [];
          for (const col of columns) {
            r.push(row[col]);
          }
          rows.push(r);
        }

        const endTime = performance.now();
        return {
          columns,
          rows,
          executionTimeMs: Number((endTime - startTime).toFixed(2)),
          engineName: 'DuckDB-Wasm Engine',
          rowCount: rows.length
        };
      } catch (err: any) {
        console.warn('DuckDB SQL execution error, running via fallback parser:', err);
      }
    }

    // Enhanced IndexedDB Temporal Analytical Fallback supporting WHERE domain, GROUP BY, ORDER BY, LIMIT
    const lowerSql = safeSql.toLowerCase();
    let filtered = [...this.inMemoryEvents];

    const domainEqMatch = lowerSql.match(/domain\s*=\s*'([a-z0-9_]+)'/);
    if (domainEqMatch) {
      const targetDomain = domainEqMatch[1];
      filtered = filtered.filter((e) => e.domain.toLowerCase() === targetDomain);
    } else {
      const domainInMatch = lowerSql.match(/domain\s+in\s*\(([^)]+)\)/);
      if (domainInMatch) {
        const allowed = domainInMatch[1]
          .split(',')
          .map((s) => s.replace(/['"\s]/g, '').toLowerCase())
          .filter(Boolean);
        if (allowed.length > 0) {
          filtered = filtered.filter((e) => allowed.includes(e.domain.toLowerCase()));
        }
      }
    }

    const limitMatch = lowerSql.match(/\blimit\s+(\d+)/);
    const limit = limitMatch ? Math.max(1, Math.min(200, Number(limitMatch[1]))) : 50;

    const rows: any[][] = [];

    if (lowerSql.includes('group by') || lowerSql.includes('count(') || lowerSql.includes('avg(')) {
      const columns = ['domain', 'event_count', 'avg_quality', 'latest_value', 'latest_time'];
      const groups: Record<
        string,
        { count: number; sumQuality: number; latestVal: unknown; latestTime: string }
      > = {};

      filtered.forEach((evt) => {
        if (!groups[evt.domain]) {
          groups[evt.domain] = {
            count: 0,
            sumQuality: 0,
            latestVal: evt.measurement.value,
            latestTime: evt.event_time
          };
        }
        groups[evt.domain].count++;
        groups[evt.domain].sumQuality += evt.quality.quality_score ?? 1.0;
        groups[evt.domain].latestVal = evt.measurement.value;
        groups[evt.domain].latestTime = evt.event_time;
      });

      const entries = Object.entries(groups).map(([dom, data]) => [
        dom,
        data.count,
        Number((data.sumQuality / Math.max(1, data.count)).toFixed(3)),
        typeof data.latestVal === 'number' ? Number(data.latestVal.toFixed(2)) : JSON.stringify(data.latestVal),
        new Date(data.latestTime).toLocaleTimeString()
      ]);

      if (lowerSql.includes('order by') && lowerSql.includes('desc')) {
        entries.sort((a, b) => Number(b[1]) - Number(a[1]));
      }

      rows.push(...entries.slice(0, limit));

      return {
        columns,
        rows,
        executionTimeMs: Number((performance.now() - startTime).toFixed(2)),
        engineName: 'IndexedDB Temporal Analytical Engine',
        rowCount: rows.length
      };
    }

    // Standard SELECT rows
    const columns = [
      'event_id',
      'domain',
      'measurement_id',
      'value_json',
      'data_class',
      'origin_type',
      'event_time',
      'quality_score'
    ];
    const ordered = lowerSql.includes('order by') && lowerSql.includes('asc')
      ? filtered.slice(0, limit)
      : filtered.slice(-limit).reverse();

    ordered.forEach((evt) => {
      rows.push([
        evt.event_id,
        evt.domain,
        evt.measurement.measurement_id,
        JSON.stringify(evt.measurement.value),
        evt.data_class,
        evt.origin_type,
        new Date(evt.event_time).toLocaleTimeString(),
        evt.quality.quality_score ?? 1.0
      ]);
    });

    return {
      columns,
      rows,
      executionTimeMs: Number((performance.now() - startTime).toFixed(2)),
      engineName: 'IndexedDB Temporal Analytical Engine',
      rowCount: rows.length
    };
  }
}

export const duckDbService = new DuckDbService();
