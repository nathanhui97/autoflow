/**
 * ExecutionTools - Standard library of tools for adaptive execution
 * These tools are invoked by the executor based on AI-generated Policy Objects
 */

export class ExecutionTools {
  /**
   * Find grid cell based on criteria
   */
  static findGridCell(params: {
    columnHeader?: string;
    condition: 'is_empty' | 'is_filled';
    searchDirection: 'down' | 'up' | 'right' | 'left';
    startRow?: number;
    startColumn?: number;
  }): Element | null {
    // Find spreadsheet container
    const spreadsheetContainer = this.findSpreadsheetContainer();
    if (!spreadsheetContainer) {
      return null;
    }

    // Find header row to get column index
    let targetColumnIndex: number | undefined;
    if (params.columnHeader) {
      targetColumnIndex = this.findColumnIndexByHeader(spreadsheetContainer, params.columnHeader);
      if (targetColumnIndex === undefined) {
        return null;
      }
    } else if (params.startColumn !== undefined) {
      targetColumnIndex = params.startColumn;
    }

    // Find starting row
    const startRow = params.startRow || 1; // Default to row 1 (after header)

    // Search in specified direction
    switch (params.searchDirection) {
      case 'down':
        return this.findCellInColumn(spreadsheetContainer, targetColumnIndex, startRow, params.condition, 'down');
      case 'up':
        return this.findCellInColumn(spreadsheetContainer, targetColumnIndex, startRow, params.condition, 'up');
      case 'right':
        return this.findCellInRow(spreadsheetContainer, startRow, targetColumnIndex || 0, params.condition, 'right');
      case 'left':
        return this.findCellInRow(spreadsheetContainer, startRow, targetColumnIndex || 0, params.condition, 'left');
      default:
        return null;
    }
  }

  /**
   * Find next empty row in grid
   */
  static findNextEmptyRow(params: {
    startRow?: number;
    columnIndex?: number;
  }): number | null {
    const spreadsheetContainer = this.findSpreadsheetContainer();
    if (!spreadsheetContainer) {
      return null;
    }

    const startRow = params.startRow || 1;
    const columnIndex = params.columnIndex || 0;

    // Find all rows
    const rows = spreadsheetContainer.querySelectorAll('[role="row"], tr, [data-row]');
    
    // Start from startRow and search down
    for (let i = startRow; i < rows.length; i++) {
      const row = rows[i];
      const cells = row.querySelectorAll('[role="cell"], td, [data-col]');
      
      if (cells[columnIndex]) {
        const cell = cells[columnIndex];
        const isEmpty = this.isCellEmpty(cell);
        
        if (isEmpty) {
          return i + 1; // Return 1-indexed row number
        }
      }
    }

    // If no empty row found, return next row after last
    return rows.length + 1;
  }

  /**
   * Find next empty column in grid
   */
  static findNextEmptyColumn(params: {
    startColumn?: number;
    rowIndex?: number;
  }): number | null {
    const spreadsheetContainer = this.findSpreadsheetContainer();
    if (!spreadsheetContainer) {
      return null;
    }

    const startColumn = params.startColumn || 0;
    const rowIndex = params.rowIndex || 1;

    // Find target row
    const rows = spreadsheetContainer.querySelectorAll('[role="row"], tr, [data-row]');
    if (rowIndex > rows.length) {
      return null;
    }

    const row = rows[rowIndex - 1]; // Convert to 0-indexed
    const cells = row.querySelectorAll('[role="cell"], td, [data-col]');

    // Start from startColumn and search right
    for (let i = startColumn; i < cells.length; i++) {
      const cell = cells[i];
      const isEmpty = this.isCellEmpty(cell);
      
      if (isEmpty) {
        return i; // Return 0-indexed column number
      }
    }

    // If no empty column found, return next column after last
    return cells.length;
  }

  /**
   * Find form field
   */
  static findFormField(params: {
    label?: string;
    fieldOrder?: number;
  }): Element | null {
    const form = document.querySelector('form');
    if (!form) {
      return null;
    }

    if (params.label) {
      // Find by label
      const labelElement = Array.from(document.querySelectorAll('label')).find(
        label => label.textContent?.trim().toLowerCase().includes(params.label!.toLowerCase())
      );

      if (labelElement) {
        const forAttr = labelElement.getAttribute('for');
        if (forAttr) {
          const field = document.getElementById(forAttr);
          if (field) {
            return field;
          }
        }

        // Check if input is inside label
        const input = labelElement.querySelector('input, textarea, select');
        if (input) {
          return input;
        }
      }

      // Try aria-label
      const fieldByAria = Array.from(form.querySelectorAll('input, textarea, select')).find(
        field => field.getAttribute('aria-label')?.toLowerCase().includes(params.label!.toLowerCase())
      );
      if (fieldByAria) {
        return fieldByAria;
      }
    }

    if (params.fieldOrder !== undefined) {
      // Find by field order
      const fields = form.querySelectorAll('input, textarea, select');
      if (fields[params.fieldOrder - 1]) {
        return fields[params.fieldOrder - 1];
      }
    }

    return null;
  }

  /**
   * Find table cell
   */
  static findTableCell(params: {
    rowIndex?: number;
    columnIndex?: number;
    headerRow?: number;
  }): Element | null {
    const table = document.querySelector('table, [role="table"], [role="grid"]');
    if (!table) {
      return null;
    }

    const rows = table.querySelectorAll('tr, [role="row"]');
    
    if (params.rowIndex !== undefined) {
      const row = rows[params.rowIndex];
      if (!row) {
        return null;
      }

      const cells = row.querySelectorAll('td, th, [role="cell"]');
      if (params.columnIndex !== undefined && cells[params.columnIndex]) {
        return cells[params.columnIndex];
      }
    }

    return null;
  }

  /**
   * Helper: Find spreadsheet container
   */
  private static findSpreadsheetContainer(): Element | null {
    // Try Google Sheets indicators
    const googleSheets = document.querySelector('[class*="waffle"], [class*="grid"], [id*="spreadsheet"], [id*="grid"]');
    if (googleSheets) {
      return googleSheets;
    }

    // Try Excel Online
    const excel = document.querySelector('[class*="excel"], [class*="office-grid"]');
    if (excel) {
      return excel;
    }

    // Try generic table/grid
    const table = document.querySelector('table[class*="grid"]');
    if (table) {
      return table;
    }

    return null;
  }

  /**
   * Helper: Find column index by header text
   */
  private static findColumnIndexByHeader(container: Element, headerText: string): number | undefined {
    // Find header row
    const headerRow = container.querySelector('[role="rowheader"], thead tr, [data-row="0"], [data-row="1"]');
    if (!headerRow) {
      return undefined;
    }

    const headerCells = headerRow.querySelectorAll('[role="columnheader"], th, [role="cell"]');
    for (let i = 0; i < headerCells.length; i++) {
      const cellText = headerCells[i].textContent?.trim().toLowerCase();
      if (cellText && cellText.includes(headerText.toLowerCase())) {
        return i;
      }
    }

    return undefined;
  }

  /**
   * Helper: Find cell in column (searching up or down)
   */
  private static findCellInColumn(
    container: Element,
    columnIndex: number | undefined,
    startRow: number,
    condition: 'is_empty' | 'is_filled',
    direction: 'down' | 'up'
  ): Element | null {
    if (columnIndex === undefined) {
      return null;
    }

    const rows = container.querySelectorAll('[role="row"], tr, [data-row]');
    const start = direction === 'down' ? startRow - 1 : rows.length - 1;
    const end = direction === 'down' ? rows.length : startRow - 1;
    const step = direction === 'down' ? 1 : -1;

    for (let i = start; i !== end; i += step) {
      const row = rows[i];
      if (!row) continue;

      const cells = row.querySelectorAll('[role="cell"], td, [data-col]');
      if (cells[columnIndex]) {
        const cell = cells[columnIndex];
        const isEmpty = this.isCellEmpty(cell);
        
        if ((condition === 'is_empty' && isEmpty) || (condition === 'is_filled' && !isEmpty)) {
          return cell;
        }
      }
    }

    return null;
  }

  /**
   * Helper: Find cell in row (searching left or right)
   */
  private static findCellInRow(
    container: Element,
    rowIndex: number,
    startColumn: number,
    condition: 'is_empty' | 'is_filled',
    direction: 'right' | 'left'
  ): Element | null {
    const rows = container.querySelectorAll('[role="row"], tr, [data-row]');
    const row = rows[rowIndex - 1]; // Convert to 0-indexed
    if (!row) {
      return null;
    }

    const cells = row.querySelectorAll('[role="cell"], td, [data-col]');
    const start = direction === 'right' ? startColumn : cells.length - 1;
    const end = direction === 'right' ? cells.length : startColumn;
    const step = direction === 'right' ? 1 : -1;

    for (let i = start; i !== end; i += step) {
      const cell = cells[i];
      if (!cell) continue;

      const isEmpty = this.isCellEmpty(cell);
      if ((condition === 'is_empty' && isEmpty) || (condition === 'is_filled' && !isEmpty)) {
        return cell;
      }
    }

    return null;
  }

  /**
   * Helper: Check if cell is empty
   */
  private static isCellEmpty(cell: Element): boolean {
    const text = cell.textContent?.trim() || '';
    const innerText = (cell as HTMLElement).innerText?.trim() || '';
    return text === '' && innerText === '';
  }
}

