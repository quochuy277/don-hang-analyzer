import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx'; // Thư viện đọc file Excel
import { AgGridReact } from 'ag-grid-react'; // Thư viện bảng dữ liệu
import 'ag-grid-community/styles/ag-grid.css'; // CSS cơ bản cho AG Grid
import 'ag-grid-community/styles/ag-theme-alpine.css'; // Theme cho AG Grid
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js'; // Thư viện biểu đồ
import { Bar, Pie, Line } from 'react-chartjs-2'; // Components biểu đồ cho React
import { jsPDF } from "jspdf"; // Thư viện tạo PDF
import 'jspdf-autotable'; // Plugin cho jsPDF để tạo bảng
import { saveAs } from 'file-saver'; // Thư viện lưu file
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval, isValid, parse as parseDateFns, getWeek, getMonth, getYear, isWithinInterval } from 'date-fns'; // Thư viện xử lý ngày tháng
import { vi } from 'date-fns/locale'; // Ngôn ngữ tiếng Việt cho date-fns

// Đăng ký các thành phần cần thiết cho Chart.js
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

// --- Các hàm tiện ích ---

// Hàm định dạng số tiền
const formatCurrency = (value) => {
  if (value === null || value === undefined) return '0';
   const numberValue = Number(value);
   if (isNaN(numberValue)) return '0';
  return numberValue.toLocaleString('vi-VN');
};

// Hàm chuẩn hóa tên cột
const normalizeHeader = (header) => {
  if (typeof header !== 'string') return '';
  return header
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s_]/g, '')
    .trim()
    .replace(/\s+/g, '_');
};

// Hàm phân tích ngày tháng (sử dụng date-fns để linh hoạt hơn)
const parseDate = (value) => {
    if (!value) return null;

    // 1. Nếu là Date object hợp lệ
    if (value instanceof Date && isValid(value)) {
      return value;
    }

    // 2. Nếu là số serial của Excel
    if (typeof value === 'number') {
      try {
        // Excel date epoch is December 30, 1899 (not January 1, 1900)
        const excelEpoch = new Date(1899, 11, 30);
        const millisecondsPerDay = 24 * 60 * 60 * 1000;
        // Adjust for Excel's leap year bug (1900 was not a leap year)
        const days = value - (value > 59 ? 1 : 0);
        const date = new Date(excelEpoch.getTime() + days * millisecondsPerDay);

        // Adjust for timezone offset if necessary (Excel dates don't have timezone info)
        const timezoneOffset = date.getTimezoneOffset() * 60000;
        const adjustedDate = new Date(date.getTime() - timezoneOffset);

        if (isValid(adjustedDate)) {
            return adjustedDate;
        }
      } catch (e) {
        console.warn("Error parsing Excel date serial:", value, e);
      }
    }

    // 3. Nếu là chuỗi, thử các định dạng phổ biến với date-fns
    if (typeof value === 'string') {
      const formatsToTry = [
        'dd/MM/yyyy HH:mm:ss',
        'dd/MM/yyyy H:mm:ss', // Giờ không có số 0 đứng trước
        'd/M/yyyy HH:mm:ss', // Ngày/tháng không có số 0 đứng trước
        'd/M/yyyy H:mm:ss',
        'dd/MM/yyyy',
        'd/M/yyyy',
        'yyyy-MM-dd HH:mm:ss',
        'yyyy-MM-dd',
        'MM/dd/yyyy HH:mm:ss',
        'MM/dd/yyyy',
      ];
      for (const fmt of formatsToTry) {
        try {
          const parsed = parseDateFns(value, fmt, new Date());
          if (isValid(parsed)) {
            return parsed;
          }
        } catch (e) {
          // Ignore parsing errors for specific formats
        }
      }
       // Thử parseISO nếu là định dạng ISO 8601
      try {
          const parsed = parseISO(value);
          if (isValid(parsed)) {
              return parsed;
          }
      } catch(e) {
          // Ignore
      }
    }

    console.warn("Could not parse date:", value);
    return null; // Return null if parsing fails
};


// Hàm lấy tên tháng và năm (MM/YYYY)
const getMonthYear = (date) => {
  if (!date || !isValid(date)) return 'Không xác định';
  return format(date, 'MM/yyyy');
};

// Hàm lấy ngày tháng năm (dd/MM/yyyy)
const getDayMonthYear = (date) => {
    if (!date || !isValid(date)) return 'Không xác định';
    return format(date, 'dd/MM/yyyy');
};

// Hàm lấy ngày tháng năm giờ phút giây (dd/MM/yyyy HH:mm:ss)
const getDateTimeString = (date) => {
    if (!date || !isValid(date)) return '';
    return format(date, 'dd/MM/yyyy HH:mm:ss');
};

// Hàm lấy định dạng Tuần/Năm (WW/YYYY)
const getWeekYear = (date) => {
    if (!date || !isValid(date)) return 'Không xác định';
    // getWeek trả về tuần theo chuẩn ISO 8601 (tuần bắt đầu từ thứ 2)
    // locale: vi để định dạng tuần đúng theo VN nếu cần (thường tuần bắt đầu từ T2)
    return `${format(date, 'ww', { locale: vi })}/${format(date, 'yyyy')}`;
};


// --- Component chính ---
function App() {
  // State cũ
  const [rawData, setRawData] = useState([]);
  const [gridData, setGridData] = useState([]);
  const [columnDefs, setColumnDefs] = useState([]);
  const [fileName, setFileName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [statistics, setStatistics] = useState(null);
  const [activeFilters, setActiveFilters] = useState({});
  const [showCharts, setShowCharts] = useState(true);

  // State mới cho thống kê tùy chỉnh
  const [storeList, setStoreList] = useState([]); // Danh sách cửa hàng
  const [revenueStatCriteria, setRevenueStatCriteria] = useState({ timePeriod: 'month', store: 'all', startDate: '', endDate: '' });
  const [orderStatCriteria, setOrderStatCriteria] = useState({ timePeriod: 'month', store: 'all', startDate: '', endDate: '' });
  const [revenueChartData, setRevenueChartData] = useState(null);
  const [orderChartData, setOrderChartData] = useState(null);
  const [customStatError, setCustomStatError] = useState('');

  const gridRef = useRef();

  // Cấu hình cột AG Grid
  const defaultColDef = useMemo(() => ({
    sortable: true, filter: true, resizable: true, floatingFilter: true, suppressMenu: true, minWidth: 100,
  }), []);

  // Hàm xử lý tải file
  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Reset state
    setFileName(file.name);
    setIsLoading(true);
    setError('');
    setRawData([]);
    setGridData([]);
    setColumnDefs([]);
    setStatistics(null);
    setActiveFilters({});
    setStoreList([]);
    setRevenueChartData(null);
    setOrderChartData(null);
    setRevenueStatCriteria({ timePeriod: 'month', store: 'all', startDate: '', endDate: '' });
    setOrderStatCriteria({ timePeriod: 'month', store: 'all', startDate: '', endDate: '' });
    setCustomStatError('');


    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target.result;
        const workbook = XLSX.read(data, { type: 'binary', cellDates: true, cellNF: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonOpts = { header: 1, defval: '', raw: true };
        const jsonDataRaw = XLSX.utils.sheet_to_json(worksheet, jsonOpts);

        if (jsonDataRaw.length < 2) throw new Error("File không có dữ liệu hoặc header.");

        const headersRaw = jsonDataRaw[0];
        const headersNormalized = headersRaw.map(normalizeHeader);

        // --- Tạo định nghĩa cột (như trước) ---
         const cols = headersNormalized.map((headerNorm, index) => {
            const headerOriginal = headersRaw[index];
            const colDef = {
                headerName: headerOriginal, field: headerNorm, valueFormatter: undefined, filter: 'agTextColumnFilter', tooltipField: headerNorm, minWidth: 150,
            };
            const dateColumns = ['ngay_doi_soat', 'thoi_gian_tao', 'thoi_gian_lay_hang', 'ngay_xac_nhan_thu_tien', 'ngay_giao_thanh_cong'];
            const currencyColumns = ['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu'];
            const numberColumns = ['khoi_luong_khach_hang'];
            const setFilterColumns = ['trang_thai', 'tinhthanh_pho_nguoi_nhan', 'nhan_vien_kinh_doanh', 'ten_cua_hang', 'nhom_vung_mien', 'don_vi_van_chuyen', 'nguon_len_don'];

            if (dateColumns.includes(headerNorm)) {
                colDef.filter = 'agDateColumnFilter';
                colDef.filterParams = {
                    comparator: (filterLocalDateAtMidnight, cellValue) => {
                        if (cellValue == null || !isValid(cellValue)) return -1;
                        const cellDateMidnight = new Date(cellValue);
                        cellDateMidnight.setHours(0, 0, 0, 0);
                        if (cellDateMidnight < filterLocalDateAtMidnight) return -1;
                        if (cellDateMidnight > filterLocalDateAtMidnight) return 1;
                        return 0;
                    },
                     browserDatePicker: true, minValidYear: 2000, maxValidYear: 2050, buttons: ['reset', 'apply'], dateFormat: 'dd/mm/yyyy',
                };
                 if (headerNorm.includes('thoi_gian') || headerNorm.includes('ngay_xac_nhan') || headerNorm.includes('ngay_giao_thanh_cong')) {
                     colDef.valueFormatter = params => getDateTimeString(params.value);
                     colDef.minWidth = 180;
                 } else {
                     colDef.valueFormatter = params => getDayMonthYear(params.value);
                 }
                 colDef.cellDataType = 'dateString';
            } else if (currencyColumns.includes(headerNorm)) {
                colDef.filter = 'agNumberColumnFilter'; colDef.type = 'numericColumn'; colDef.valueFormatter = params => formatCurrency(params.value); colDef.cellDataType = 'number';
            } else if (numberColumns.includes(headerNorm)) {
                 colDef.filter = 'agNumberColumnFilter'; colDef.type = 'numericColumn'; colDef.cellDataType = 'number';
            } else if (setFilterColumns.includes(headerNorm)) {
                 colDef.filter = 'agSetColumnFilter'; colDef.minWidth = 180;
            } else {
                 colDef.cellDataType = 'text';
            }
            return colDef;
        });

        // --- Chuyển đổi dữ liệu hàng và lấy danh sách cửa hàng ---
        const uniqueStores = new Set();
        const dataRows = jsonDataRaw.slice(1).map((row, rowIndex) => {
          const rowData = {};
          headersNormalized.forEach((headerNorm, index) => {
            let value = row[index];
            const dateColumns = ['ngay_doi_soat', 'thoi_gian_tao', 'thoi_gian_lay_hang', 'ngay_xac_nhan_thu_tien', 'ngay_giao_thanh_cong'];
            if (dateColumns.includes(headerNorm)) {
                value = parseDate(value);
            }
            else if (['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu', 'khoi_luong_khach_hang'].includes(headerNorm)) {
                if (value === null || value === undefined || value === '') { value = 0; }
                else if (typeof value === 'string') { const cleanedValue = value.replace(/\./g, '').replace(/,/g, '.'); const num = parseFloat(cleanedValue); value = isNaN(num) ? 0 : num; }
                else if (typeof value !== 'number') { value = 0; }
            }
            else if (value === null || value === undefined) { value = ''; }
            else { value = String(value); }

            rowData[headerNorm] = value;

            // Thêm vào danh sách cửa hàng nếu có cột 'ten_cua_hang'
            if (headerNorm === 'ten_cua_hang' && value) {
                uniqueStores.add(value);
            }
          });
          rowData.id = rowIndex;
          return rowData;
        });

        setColumnDefs(cols);
        setRawData(dataRows);
        setGridData(dataRows);
        calculateStatistics(dataRows); // Tính thống kê tổng quan ban đầu
        setStoreList(['all', ...Array.from(uniqueStores).sort()]); // Cập nhật danh sách cửa hàng ('all' là Tất cả)

      } catch (err) {
        console.error("Lỗi xử lý file:", err);
        setError(`Lỗi xử lý file: ${err.message}. Vui lòng kiểm tra định dạng file và cấu trúc cột.`);
      } finally {
        setIsLoading(false);
        if (event.target) event.target.value = null;
      }
    };
    reader.onerror = (err) => {
        console.error("Lỗi đọc file:", err);
        setError("Không thể đọc file. Vui lòng thử lại.");
        setIsLoading(false);
         if (event.target) event.target.value = null;
    };
    reader.readAsBinaryString(file);
  }, []);

  // Hàm tính toán thống kê tổng quan (như trước)
  const calculateStatistics = (data) => {
     if (!data || data.length === 0) { setStatistics(null); return; }
     const totalOrders = data.length; let totalRevenue = 0; let totalShippingFee = 0;
     const statusCounts = {}; const storeCounts = {}; const cityCounts = {}; const salesRepCounts = {};
     const monthlyRevenue = {}; const dailyOrders = {};
     data.forEach(row => {
       totalRevenue += Number(row.doanh_thu) || 0; totalShippingFee += Number(row.phi_van_chuyen) || 0;
       const status = row.trang_thai || 'Không xác định'; statusCounts[status] = (statusCounts[status] || 0) + 1;
       const store = row.ten_cua_hang || 'Không xác định'; storeCounts[store] = (storeCounts[store] || 0) + 1;
       const city = row.tinhthanh_pho_nguoi_nhan || 'Không xác định'; cityCounts[city] = (cityCounts[city] || 0) + 1;
       const salesRep = row.nhan_vien_kinh_doanh || 'Không xác định'; salesRepCounts[salesRep] = (salesRepCounts[salesRep] || 0) + 1;
       const relevantDate = row.ngay_giao_thanh_cong instanceof Date && isValid(row.ngay_giao_thanh_cong) ? row.ngay_giao_thanh_cong : (row.ngay_doi_soat instanceof Date && isValid(row.ngay_doi_soat) ? row.ngay_doi_soat : null);
       if (relevantDate) {
           const monthYear = getMonthYear(relevantDate); monthlyRevenue[monthYear] = (monthlyRevenue[monthYear] || 0) + (Number(row.doanh_thu) || 0);
           const dayMonthYear = getDayMonthYear(relevantDate); dailyOrders[dayMonthYear] = (dailyOrders[dayMonthYear] || 0) + 1;
       }
     });
     const sortedStatus = Object.entries(statusCounts).sort(([, a], [, b]) => b - a);
     const sortedStores = Object.entries(storeCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
     const sortedCities = Object.entries(cityCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
     const sortedSalesReps = Object.entries(salesRepCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
     const sortedMonthlyRevenue = Object.entries(monthlyRevenue).sort(([a], [b]) => { const [m1, y1] = a.split('/'); const [m2, y2] = b.split('/'); if (!y1 || !m1 || !y2 || !m2) return 0; return new Date(y1, m1 - 1) - new Date(y2, m2 - 1); });
     const sortedDailyOrders = Object.entries(dailyOrders).sort(([a], [b]) => { const [d1, m1, y1] = a.split('/'); const [d2, m2, y2] = b.split('/'); if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0; return new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2); });
     setStatistics({ totalOrders, totalRevenue, totalShippingFee, statusCounts: Object.fromEntries(sortedStatus), storeCounts: Object.fromEntries(sortedStores), cityCounts: Object.fromEntries(sortedCities), salesRepCounts: Object.fromEntries(sortedSalesReps), monthlyRevenue: Object.fromEntries(sortedMonthlyRevenue), dailyOrders: Object.fromEntries(sortedDailyOrders), });
   };

  // Hàm được gọi khi bộ lọc AG Grid thay đổi
  const onFilterChanged = useCallback(() => {
    if (gridRef.current && gridRef.current.api) {
      const filterModel = gridRef.current.api.getFilterModel();
      setActiveFilters(filterModel);
      const filteredData = [];
      gridRef.current.api.forEachNodeAfterFilter(node => filteredData.push(node.data));
      calculateStatistics(filteredData); // Cập nhật thống kê tổng quan theo bộ lọc grid
    }
  }, []);

   // Hàm reset bộ lọc AG Grid
  const resetFilters = useCallback(() => {
    if (gridRef.current && gridRef.current.api) {
      gridRef.current.api.setFilterModel(null);
      setActiveFilters({});
      calculateStatistics(rawData); // Tính lại thống kê tổng quan trên dữ liệu gốc
    }
  }, [rawData]);

  // Hàm xuất Excel (như trước)
  const exportToExcel = useCallback(() => { /* ... giữ nguyên code export Excel ... */
    if (!gridRef.current || !gridRef.current.api) return;
    const params = {
        fileName: `BaoCao_${format(new Date(), 'yyyyMMdd')}.xlsx`,
        processCellCallback: (params) => {
            const value = params.value;
            if (value instanceof Date && isValid(value)) {
                 const colId = params.column.getColId();
                 if (colId.includes('thoi_gian') || colId.includes('ngay_xac_nhan') || colId.includes('ngay_giao_thanh_cong')) {
                    return getDateTimeString(value);
                 } else {
                    return getDayMonthYear(value);
                 }
            }
            return value;
        }
    };
    gridRef.current.api.exportDataAsExcel(params);
  }, []);

   // Hàm xuất PDF (như trước)
  const exportToPdf = useCallback(() => { /* ... giữ nguyên code export PDF ... */
    if (!gridRef.current || !gridRef.current.api) return;
    const doc = new jsPDF({ orientation: 'landscape' });
    const columnsToExport = columnDefs
      .filter(cd => cd.field && !['stt', 'sdt_nguoi_tao', 'dia_chi_nguoi_tao', 'phuongxa_tao', 'quanhuyen_tao', 'sdt_nguoi_gui_hang', 'dia_chi_nguoi_gui_hang', 'phuongxa_gui_hang', 'quanhuyen_gui_hang', 'sdt_nguoi_nhan', 'dia_chi_nguoi_nhan', 'phuongxa_nguoi_nhan', 'ghi_chu_giao_hang', 'ghi_chu_noi_bo', 'ghi_chu_cong_khai', 'tai_khoan_doi_tac', 'ma_don_doi_tac', 'ma_don_hang_mot_phan'].includes(cd.field))
      .map(cd => ({ header: cd.headerName, dataKey: cd.field }));
    const tableRows = [];
    gridRef.current.api.forEachNodeAfterFilter(node => {
        const rowData = {};
         columnsToExport.forEach(col => {
            let value = node.data[col.dataKey];
             if (value instanceof Date && isValid(value)) {
                 if (col.dataKey.includes('thoi_gian') || col.dataKey.includes('ngay_xac_nhan') || col.dataKey.includes('ngay_giao_thanh_cong')) { value = getDateTimeString(value); }
                 else { value = getDayMonthYear(value); }
             } else if (typeof value === 'number' && ['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu'].includes(col.dataKey)) { value = formatCurrency(value); }
             value = value !== null && value !== undefined ? String(value) : '';
              rowData[col.dataKey] = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
        });
        tableRows.push(rowData);
    });
     doc.setFont('helvetica');
     doc.text(`Bao cao don hang (${format(new Date(), 'dd/MM/yyyy')})`, 14, 15);
    doc.autoTable({ columns: columnsToExport, body: tableRows, startY: 20, theme: 'grid', styles: { font: 'helvetica', fontSize: 7, cellPadding: 1, overflow: 'linebreak', }, headStyles: { fillColor: [22, 160, 133], textColor: 255, fontStyle: 'bold', fontSize: 8, }, });
    doc.save(`BaoCao_${format(new Date(), 'yyyyMMdd')}.pdf`);
  }, [columnDefs]);

  // --- Logic cho Thống kê Tùy chỉnh ---

  // Hàm tính toán và cập nhật biểu đồ tùy chỉnh
  const updateCustomStats = useCallback((type) => { // type = 'revenue' or 'order'
    setCustomStatError(''); // Xóa lỗi cũ
    const criteria = type === 'revenue' ? revenueStatCriteria : orderStatCriteria;
    const { timePeriod, store, startDate, endDate } = criteria;
    const dateField = 'ngay_giao_thanh_cong'; // Hoặc 'ngay_doi_soat' nếu muốn

    // 1. Lọc dữ liệu theo cửa hàng
    const storeFilteredData = store === 'all'
      ? rawData
      : rawData.filter(row => row.ten_cua_hang === store);

    // 2. Lọc dữ liệu theo thời gian
    let timeFilteredData = [];
    let dateRange = { start: null, end: null };

    if (timePeriod === 'custom') {
        const start = startDate ? parseDateFns(startDate, 'yyyy-MM-dd', new Date()) : null;
        const end = endDate ? parseDateFns(endDate, 'yyyy-MM-dd', new Date()) : null;
        if (start && end && isValid(start) && isValid(end) && start <= end) {
            dateRange = { start: start, end: end };
            timeFilteredData = storeFilteredData.filter(row => {
                const dateValue = row[dateField];
                return dateValue instanceof Date && isValid(dateValue) && isWithinInterval(dateValue, dateRange);
            });
        } else {
             setCustomStatError('Khoảng ngày tùy chọn không hợp lệ.');
             if (type === 'revenue') setRevenueChartData(null); else setOrderChartData(null);
             return;
        }
    } else {
        // Lấy ngày đầu và cuối của toàn bộ dữ liệu để xác định khoảng thời gian
        const validDates = storeFilteredData
            .map(row => row[dateField])
            .filter(date => date instanceof Date && isValid(date));

        if (validDates.length === 0) {
             setCustomStatError('Không có dữ liệu ngày hợp lệ để thống kê.');
             if (type === 'revenue') setRevenueChartData(null); else setOrderChartData(null);
             return;
        }

        const minDate = new Date(Math.min(...validDates));
        const maxDate = new Date(Math.max(...validDates));
        dateRange = { start: minDate, end: maxDate };
        timeFilteredData = storeFilteredData.filter(row => row[dateField] instanceof Date && isValid(row[dateField])); // Lọc bỏ ngày không hợp lệ
    }

    if (timeFilteredData.length === 0) {
         setCustomStatError('Không có dữ liệu phù hợp với tiêu chí đã chọn.');
         if (type === 'revenue') setRevenueChartData(null); else setOrderChartData(null);
         return;
    }


    // 3. Nhóm dữ liệu và tính toán
    const aggregatedData = {};

    timeFilteredData.forEach(row => {
        const dateValue = row[dateField];
        let key = '';

        switch (timePeriod) {
            case 'day':
            case 'custom': // Khi custom, cũng nhóm theo ngày trong khoảng đó
                key = getDayMonthYear(dateValue);
                break;
            case 'week':
                key = getWeekYear(dateValue);
                break;
            case 'month':
            default:
                key = getMonthYear(dateValue);
                break;
        }

        if (key && key !== 'Không xác định') {
            if (!aggregatedData[key]) {
                aggregatedData[key] = { revenue: 0, count: 0, date: dateValue }; // Lưu date để sắp xếp
            }
            aggregatedData[key].revenue += Number(row.doanh_thu) || 0;
            aggregatedData[key].count += 1;
        }
    });

    // 4. Chuẩn bị dữ liệu cho biểu đồ
    // Sắp xếp các key (ngày, tuần, tháng) theo thứ tự thời gian
    const sortedKeys = Object.keys(aggregatedData).sort((a, b) => {
        const dateA = aggregatedData[a].date;
        const dateB = aggregatedData[b].date;
        return dateA - dateB;
    });

    const chartLabels = sortedKeys;
    const chartValues = sortedKeys.map(key => type === 'revenue' ? aggregatedData[key].revenue : aggregatedData[key].count);

    const chartData = {
        labels: chartLabels,
        datasets: [
            {
                label: type === 'revenue' ? 'Doanh thu (VNĐ)' : 'Số đơn hàng',
                data: chartValues,
                backgroundColor: type === 'revenue' ? 'rgba(75, 192, 192, 0.6)' : 'rgba(54, 162, 235, 0.6)',
                borderColor: type === 'revenue' ? 'rgb(75, 192, 192)' : 'rgb(54, 162, 235)',
                borderWidth: 1,
                tension: 0.1, // Cho biểu đồ đường
            },
        ],
    };

    if (type === 'revenue') {
        setRevenueChartData(chartData);
    } else {
        setOrderChartData(chartData);
    }

  }, [rawData, revenueStatCriteria, orderStatCriteria]);

  // Hàm xử lý thay đổi tiêu chí
  const handleCriteriaChange = (type, field, value) => {
    if (type === 'revenue') {
      setRevenueStatCriteria(prev => ({ ...prev, [field]: value }));
    } else {
      setOrderStatCriteria(prev => ({ ...prev, [field]: value }));
    }
     // Tự động cập nhật khi thay đổi dropdown, nhưng cần nút bấm cho date range
     if (field !== 'startDate' && field !== 'endDate') {
         // Delay nhẹ để đợi state cập nhật hoàn chỉnh trước khi tính toán
         setTimeout(() => updateCustomStats(type), 0);
     }
  };

  // Gọi update khi component mount lần đầu nếu có dữ liệu
  useEffect(() => {
     if(rawData.length > 0) {
         updateCustomStats('revenue');
         updateCustomStats('order');
     }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawData]); // Chỉ chạy khi rawData thay đổi (tức là sau khi tải file)


  // --- Render UI ---
  return (
    <div className="container mx-auto p-4 font-sans">
      {/* Header */}
      <header className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white p-6 rounded-lg shadow-lg mb-6">
        <h1 className="text-3xl font-bold mb-2">Trình Phân Tích Dữ Liệu Đơn Hàng</h1>
        <p className="text-indigo-100">Tải lên file Excel (.xlsx, .csv) để xem thống kê và lọc dữ liệu.</p>
      </header>

       {/* Khu vực tải file */}
       <div className="mb-6 p-6 bg-white rounded-lg shadow border border-gray-200">
         <label htmlFor="fileInput" className="block text-lg font-semibold text-gray-700 mb-3">Chọn file Excel hoặc CSV:</label>
         <input type="file" id="fileInput" accept=".xlsx, .csv" onChange={handleFileUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 cursor-pointer" disabled={isLoading}/>
         {fileName && !isLoading && <p className="text-sm text-gray-600 mt-2">Đã chọn file: {fileName}</p>}
         {isLoading && <p className="text-blue-600 mt-2 animate-pulse">Đang xử lý file, vui lòng đợi...</p>}
         {error && <p className="text-red-600 mt-2 font-semibold">{error}</p>}
       </div>

      {/* Khu vực thống kê tổng quan và biểu đồ (như trước) */}
      {statistics && (
        <div className="mb-6">
           <div className="flex justify-between items-center mb-4">
             <h2 className="text-2xl font-semibold text-gray-800">Thống Kê Tổng Quan (Dựa trên bộ lọc bảng)</h2>
             <button onClick={() => setShowCharts(!showCharts)} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm">
                {showCharts ? 'Ẩn Biểu Đồ Chung' : 'Hiện Biểu Đồ Chung'}
             </button>
           </div>
           {/* ... Phần thẻ số liệu và biểu đồ tổng quan giữ nguyên ... */}
            {/* Các thẻ số liệu tổng quan */}
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
             <div className="bg-white p-4 rounded-lg shadow border border-blue-100"> <h3 className="text-sm font-medium text-blue-600">Tổng Số Đơn Hàng</h3> <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalOrders)}</p> </div>
             <div className="bg-white p-4 rounded-lg shadow border border-green-100"> <h3 className="text-sm font-medium text-green-600">Tổng Doanh Thu</h3> <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalRevenue)} đ</p> </div>
             <div className="bg-white p-4 rounded-lg shadow border border-orange-100"> <h3 className="text-sm font-medium text-orange-600">Tổng Phí Vận Chuyển</h3> <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalShippingFee)} đ</p> </div>
           </div>
            {/* Khu vực biểu đồ chung (có thể ẩn/hiện) */}
           {showCharts && ( <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6"> {/* Biểu đồ Trạng thái */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Trạng Thái Đơn Hàng</h3> <div style={{ height: '300px', position: 'relative' }}> <Pie data={{ labels: Object.keys(statistics.statusCounts), datasets: [{ label: 'Số lượng', data: Object.values(statistics.statusCounts), backgroundColor: ['rgba(54, 162, 235, 0.8)', 'rgba(255, 99, 132, 0.8)', 'rgba(75, 192, 192, 0.8)', 'rgba(255, 206, 86, 0.8)', 'rgba(153, 102, 255, 0.8)', 'rgba(255, 159, 64, 0.8)', 'rgba(99, 255, 132, 0.8)', 'rgba(201, 203, 207, 0.8)'], borderColor: 'rgba(255, 255, 255, 0.9)', borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, padding: 15 } }, tooltip: { callbacks: { label: function(context) { let label = context.label || ''; if (label) { label += ': '; } if (context.parsed !== null) { label += formatCurrency(context.parsed); } const total = context.dataset.data.reduce((acc, value) => acc + value, 0); const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) + '%' : '0%'; label += ` (${percentage})`; return label; } } } } }} /> </div> </div> {/* Biểu đồ Doanh thu theo tháng */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Doanh Thu Theo Tháng (Chung)</h3> <div style={{ height: '300px', position: 'relative' }}> <Line data={{ labels: Object.keys(statistics.monthlyRevenue), datasets: [{ label: 'Doanh thu (VNĐ)', data: Object.values(statistics.monthlyRevenue), borderColor: 'rgb(75, 192, 192)', backgroundColor: 'rgba(75, 192, 192, 0.2)', tension: 0.1, fill: true, pointBackgroundColor: 'rgb(75, 192, 192)', pointBorderColor: '#fff', pointHoverBackgroundColor: '#fff', pointHoverBorderColor: 'rgb(75, 192, 192)' }] }} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) + ' đ' } } }, plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)} đ` } } } }} /> </div> </div> {/* Biểu đồ Số đơn theo ngày */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Số Đơn Theo Ngày (Chung)</h3> <div style={{ height: '300px', position: 'relative' }}> <Line data={{ labels: Object.keys(statistics.dailyOrders), datasets: [{ label: 'Số đơn', data: Object.values(statistics.dailyOrders), borderColor: 'rgb(255, 159, 64)', backgroundColor: 'rgba(255, 159, 64, 0.2)', tension: 0.1, fill: false, pointRadius: 2, pointBackgroundColor: 'rgb(255, 159, 64)', pointBorderColor: '#fff', pointHoverBackgroundColor: '#fff', pointHoverBorderColor: 'rgb(255, 159, 64)' }] }} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }, plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}` } } } }} /> </div> </div> {/* Biểu đồ Top Cửa hàng */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 Cửa Hàng (Số đơn)</h3> <div style={{ height: '300px', position: 'relative' }}> <Bar data={{ labels: Object.keys(statistics.storeCounts), datasets: [{ label: 'Số đơn', data: Object.values(statistics.storeCounts), backgroundColor: 'rgba(153, 102, 255, 0.8)', borderColor: 'rgba(153, 102, 255, 1)', borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` } } } }} /> </div> </div> {/* Biểu đồ Top Tỉnh/Thành phố */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 Tỉnh/Thành Phố (Số đơn)</h3> <div style={{ height: '300px', position: 'relative' }}> <Bar data={{ labels: Object.keys(statistics.cityCounts), datasets: [{ label: 'Số đơn', data: Object.values(statistics.cityCounts), backgroundColor: 'rgba(54, 162, 235, 0.8)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` } } } }} /> </div> </div> {/* Biểu đồ Top NVKD */} <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]"> <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 NVKD (Số đơn)</h3> <div style={{ height: '300px', position: 'relative' }}> <Bar data={{ labels: Object.keys(statistics.salesRepCounts), datasets: [{ label: 'Số đơn', data: Object.values(statistics.salesRepCounts), backgroundColor: 'rgba(255, 99, 132, 0.8)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1 }] }} options={{ responsive: true, maintainAspectRatio: false, indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` } } } }} /> </div> </div> </div> )}
        </div>
      )}

       {/* --- Khu vực Thống kê Tùy chỉnh --- */}
       {rawData.length > 0 && (
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Thống kê Doanh thu Tùy chỉnh */}
            <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Thống kê Doanh thu Tùy chỉnh</h2>
                {/* Bộ lọc */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {/* Lọc theo thời gian */}
                    <div>
                        <label htmlFor="revenueTimePeriod" className="block text-sm font-medium text-gray-700 mb-1">Theo thời gian:</label>
                        <select
                            id="revenueTimePeriod"
                            value={revenueStatCriteria.timePeriod}
                            onChange={(e) => handleCriteriaChange('revenue', 'timePeriod', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                        >
                            <option value="day">Theo Ngày</option>
                            <option value="week">Theo Tuần</option>
                            <option value="month">Theo Tháng</option>
                            <option value="custom">Tùy chọn khoảng</option>
                        </select>
                    </div>
                     {/* Lọc theo cửa hàng */}
                     <div>
                        <label htmlFor="revenueStore" className="block text-sm font-medium text-gray-700 mb-1">Theo cửa hàng:</label>
                        <select
                            id="revenueStore"
                            value={revenueStatCriteria.store}
                            onChange={(e) => handleCriteriaChange('revenue', 'store', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            disabled={storeList.length <= 1} // Disable nếu không có cửa hàng nào
                        >
                            {storeList.map(store => (
                                <option key={store} value={store}>{store === 'all' ? 'Tất cả cửa hàng' : store}</option>
                            ))}
                        </select>
                    </div>
                </div>
                 {/* Lọc theo khoảng ngày tùy chọn */}
                 {revenueStatCriteria.timePeriod === 'custom' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-end">
                        <div>
                            <label htmlFor="revenueStartDate" className="block text-sm font-medium text-gray-700 mb-1">Từ ngày:</label>
                            <input
                                type="date"
                                id="revenueStartDate"
                                value={revenueStatCriteria.startDate}
                                onChange={(e) => handleCriteriaChange('revenue', 'startDate', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            />
                        </div>
                        <div>
                            <label htmlFor="revenueEndDate" className="block text-sm font-medium text-gray-700 mb-1">Đến ngày:</label>
                            <input
                                type="date"
                                id="revenueEndDate"
                                value={revenueStatCriteria.endDate}
                                onChange={(e) => handleCriteriaChange('revenue', 'endDate', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            />
                        </div>
                        <button
                            onClick={() => updateCustomStats('revenue')}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
                        >
                            Xem
                        </button>
                    </div>
                 )}

                {/* Biểu đồ Doanh thu */}
                <div className="mt-4 min-h-[300px]">
                    {revenueChartData ? (
                        <div style={{ height: '300px', position: 'relative' }}>
                             <Bar // Hoặc Line tùy theo timePeriod
                                data={revenueChartData}
                                options={{
                                    responsive: true, maintainAspectRatio: false,
                                    scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) + ' đ' } } },
                                    plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)} đ` } } }
                                }}
                            />
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 mt-10">{customStatError || 'Chọn tiêu chí để xem thống kê doanh thu.'}</p>
                    )}
                </div>
            </div>

            {/* Thống kê Đơn hàng Tùy chỉnh */}
             <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Thống kê Đơn hàng Tùy chỉnh</h2>
                 {/* Bộ lọc */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    {/* Lọc theo thời gian */}
                    <div>
                        <label htmlFor="orderTimePeriod" className="block text-sm font-medium text-gray-700 mb-1">Theo thời gian:</label>
                        <select
                            id="orderTimePeriod"
                            value={orderStatCriteria.timePeriod}
                            onChange={(e) => handleCriteriaChange('order', 'timePeriod', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                        >
                            <option value="day">Theo Ngày</option>
                            <option value="week">Theo Tuần</option>
                            <option value="month">Theo Tháng</option>
                            <option value="custom">Tùy chọn khoảng</option>
                        </select>
                    </div>
                     {/* Lọc theo cửa hàng */}
                     <div>
                        <label htmlFor="orderStore" className="block text-sm font-medium text-gray-700 mb-1">Theo cửa hàng:</label>
                        <select
                            id="orderStore"
                            value={orderStatCriteria.store}
                            onChange={(e) => handleCriteriaChange('order', 'store', e.target.value)}
                            className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            disabled={storeList.length <= 1}
                        >
                             {storeList.map(store => (
                                <option key={store} value={store}>{store === 'all' ? 'Tất cả cửa hàng' : store}</option>
                            ))}
                        </select>
                    </div>
                </div>
                 {/* Lọc theo khoảng ngày tùy chọn */}
                 {orderStatCriteria.timePeriod === 'custom' && (
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4 items-end">
                        <div>
                            <label htmlFor="orderStartDate" className="block text-sm font-medium text-gray-700 mb-1">Từ ngày:</label>
                            <input
                                type="date"
                                id="orderStartDate"
                                value={orderStatCriteria.startDate}
                                onChange={(e) => handleCriteriaChange('order', 'startDate', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            />
                        </div>
                        <div>
                            <label htmlFor="orderEndDate" className="block text-sm font-medium text-gray-700 mb-1">Đến ngày:</label>
                            <input
                                type="date"
                                id="orderEndDate"
                                value={orderStatCriteria.endDate}
                                onChange={(e) => handleCriteriaChange('order', 'endDate', e.target.value)}
                                className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                            />
                        </div>
                        <button
                            onClick={() => updateCustomStats('order')}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
                        >
                            Xem
                        </button>
                    </div>
                 )}

                {/* Biểu đồ Đơn hàng */}
                 <div className="mt-4 min-h-[300px]">
                    {orderChartData ? (
                        <div style={{ height: '300px', position: 'relative' }}>
                             <Bar // Hoặc Line tùy theo timePeriod
                                data={orderChartData}
                                options={{
                                    responsive: true, maintainAspectRatio: false,
                                    scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } }, // Format số nguyên
                                    plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}` } } }
                                }}
                            />
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 mt-10">{customStatError || 'Chọn tiêu chí để xem thống kê đơn hàng.'}</p>
                    )}
                </div>
            </div>
        </div>
       )}


      {/* Khu vực bảng dữ liệu chi tiết và bộ lọc (như trước) */}
      {columnDefs.length > 0 && (
        <div className="mt-8 bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h2 className="text-2xl font-semibold text-gray-800">Dữ Liệu Chi Tiết</h2>
            <div className="flex gap-2 flex-wrap">
               <button onClick={resetFilters} className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed" disabled={Object.keys(activeFilters).length === 0} title="Xóa tất cả bộ lọc đang áp dụng">Xóa Bộ Lọc</button>
              <button onClick={exportToExcel} className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium shadow" title="Xuất dữ liệu đang hiển thị trong bảng ra file Excel">Xuất Excel</button>
               <button onClick={exportToPdf} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium shadow" title="Xuất dữ liệu đang hiển thị trong bảng ra file PDF">Xuất PDF</button>
            </div>
          </div>
           {/* Hiển thị bộ lọc đang áp dụng */}
          {Object.keys(activeFilters).length > 0 && ( <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700"> <span className="font-semibold">Bộ lọc bảng đang áp dụng:</span> <ul className="list-disc list-inside ml-4 mt-1 space-y-1"> {Object.entries(activeFilters).map(([field, filter]) => { let filterValue = ''; const headerName = columnDefs.find(c => c.field === field)?.headerName || field; if (filter.filterType === 'text') { filterValue = `${filter.type}: "${filter.filter}"`; } else if (filter.filterType === 'number') { filterValue = `${filter.type}: ${formatCurrency(filter.filter)}`; } else if (filter.filterType === 'set') { filterValue = `Trong (${filter.values.slice(0, 5).join(', ')}${filter.values.length > 5 ? ', ...' : ''})`; } else if (filter.filterType === 'date') { const dateFrom = filter.dateFrom ? filter.dateFrom.split(' ')[0] : ''; const dateTo = filter.dateTo ? filter.dateTo.split(' ')[0] : ''; filterValue = `${filter.type}: ${dateFrom}${dateTo ? ' đến ' + dateTo : ''}`; } else { filterValue = JSON.stringify(filter); } return <li key={field}><span className='font-medium'>{headerName}:</span> {filterValue}</li>; })} </ul> </div> )}
          {/* AG Grid */}
          <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
            <AgGridReact ref={gridRef} rowData={gridData} columnDefs={columnDefs} defaultColDef={defaultColDef} pagination={true} paginationPageSize={100} animateRows={true} onFilterChanged={onFilterChanged} enableCellTextSelection={true} suppressExcelExport={true} tooltipShowDelay={300} rowSelection={'multiple'} suppressColumnVirtualisation={false} suppressRowVirtualisation={false} debounceVerticalScrollbar={true} sideBar={true} />
          </div>
        </div>
      )}

        {/* Hướng dẫn sử dụng cơ bản */}
        {rawData.length === 0 && !isLoading && ( <div className="mt-8 p-6 bg-gray-50 rounded-lg border border-gray-200"> <h3 className="text-xl font-semibold text-gray-700 mb-3">Hướng dẫn nhanh</h3> <ol className="list-decimal list-inside space-y-2 text-gray-600"> <li>Nhấn nút "Chọn file Excel hoặc CSV" và chọn file dữ liệu đơn hàng.</li> <li>Đợi ứng dụng đọc và xử lý dữ liệu.</li> <li>Xem thống kê tổng quan và các biểu đồ chung.</li> <li>Sử dụng các bộ lọc trong phần "Thống kê Tùy chỉnh" để xem doanh thu/đơn hàng theo ngày/tuần/tháng hoặc khoảng tùy chọn và theo cửa hàng cụ thể.</li> <li>Sử dụng bảng "Dữ Liệu Chi Tiết" để xem, lọc và sắp xếp dữ liệu gốc. Bộ lọc ở đây sẽ cập nhật các biểu đồ chung.</li> <li>Nhấn "Xóa Bộ Lọc" để xóa bộ lọc trong bảng dữ liệu chi tiết.</li> <li>Nhấn "Xuất Excel" hoặc "Xuất PDF" để tải báo cáo từ bảng dữ liệu chi tiết.</li> </ol> <p className="mt-4 text-sm text-gray-500">Lưu ý: Xử lý file lớn (>100.000 dòng) trên trình duyệt có thể tốn tài nguyên.</p> </div> )}

      <footer className="text-center mt-8 text-sm text-gray-500">
        <p>Được tạo bởi Huy Nguyen.</p>
      </footer>
    </div>
  );
}

export default App;
