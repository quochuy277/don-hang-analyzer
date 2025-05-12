import React, { useState, useCallback, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx'; // Thư viện đọc file Excel
import { AgGridReact } from 'ag-grid-react'; // Thư viện bảng dữ liệu
import 'ag-grid-community/styles/ag-grid.css'; // CSS cơ bản cho AG Grid
import 'ag-grid-community/styles/ag-theme-alpine.css'; // Theme cho AG Grid
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement, PointElement, LineElement } from 'chart.js'; // Thư viện biểu đồ
import { Bar, Pie, Line } from 'react-chartjs-2'; // Components biểu đồ cho React
import { jsPDF } from "jspdf"; // Thư viện tạo PDF
import 'jspdf-autotable'; // Plugin cho jsPDF để tạo bảng
import { saveAs } from 'file-saver'; // Thư viện lưu file

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

// Hàm định dạng số tiền (ví dụ: 100000 -> 100.000)
const formatCurrency = (value) => {
  if (value === null || value === undefined) return '0';
   // Chuyển đổi sang số nếu là chuỗi trước khi định dạng
   const numberValue = Number(value);
   if (isNaN(numberValue)) return '0'; // Trả về 0 nếu không phải số hợp lệ
  return numberValue.toLocaleString('vi-VN');
};

// Hàm chuẩn hóa tên cột từ file Excel (loại bỏ dấu, khoảng trắng thừa, viết thường)
const normalizeHeader = (header) => {
  if (typeof header !== 'string') return ''; // Xử lý trường hợp header không phải là chuỗi
  return header
    .toLowerCase()
    .normalize("NFD") // Chuẩn hóa Unicode (tách dấu)
    .replace(/[\u0300-\u036f]/g, "") // Loại bỏ dấu
    .replace(/đ/g, "d") // Thay 'đ' thành 'd'
    .replace(/[^a-z0-9\s_]/g, '') // Loại bỏ ký tự đặc biệt trừ khoảng trắng và gạch dưới
    .trim() // Loại bỏ khoảng trắng đầu/cuối
    .replace(/\s+/g, '_'); // Thay khoảng trắng bằng gạch dưới
};

// Hàm phân tích ngày tháng (cập nhật để xử lý dd/mm/yyyy hh:mm:ss)
const parseDate = (value) => {
  if (!value) return null;

  // 1. Ưu tiên xử lý định dạng chuỗi 'dd/mm/yyyy hh:mm:ss'
  if (typeof value === 'string') {
    const dateTimeRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/;
    const match = value.match(dateTimeRegex);
    if (match) {
      try {
        // Lưu ý: Tháng trong new Date() là 0-indexed (0 = Tháng 1, 1 = Tháng 2, ...)
        const day = parseInt(match[1], 10);
        const month = parseInt(match[2], 10) - 1; // Trừ 1 để đúng index
        const year = parseInt(match[3], 10);
        const hour = parseInt(match[4], 10);
        const minute = parseInt(match[5], 10);
        const second = parseInt(match[6], 10);
        const date = new Date(year, month, day, hour, minute, second);
        // Kiểm tra xem ngày có hợp lệ không (ví dụ: không phải ngày 31/02)
        if (!isNaN(date.getTime()) &&
            date.getFullYear() === year &&
            date.getMonth() === month &&
            date.getDate() === day) {
          return date;
        }
      } catch (e) {
        console.warn("Lỗi khi parse định dạng dd/mm/yyyy hh:mm:ss:", value, e);
      }
    }
     // Nếu không khớp định dạng trên, thử các định dạng ngày khác (dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd)
     const dateOnlyRegex = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
     const dateOnlyMatch = value.match(dateOnlyRegex);
     if (dateOnlyMatch) {
         try {
             const day = parseInt(dateOnlyMatch[1], 10);
             const month = parseInt(dateOnlyMatch[2], 10) - 1;
             const year = parseInt(dateOnlyMatch[3], 10);
             const date = new Date(year, month, day);
             if (!isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) {
                 return date;
             }
         } catch (e) {
             console.warn("Lỗi khi parse định dạng dd/mm/yyyy:", value, e);
         }
     }

      // Thử các định dạng khác mà Date.parse hỗ trợ (ít tin cậy hơn cho định dạng cụ thể)
      try {
          const parsed = Date.parse(value);
          if (!isNaN(parsed)) {
              return new Date(parsed);
          }
      } catch(e) {
          // Bỏ qua
      }
  }

  // 2. Xử lý số serial của Excel
  if (typeof value === 'number') {
    try {
      const excelEpoch = new Date(1899, 11, 30);
      const millisecondsPerDay = 24 * 60 * 60 * 1000;
      // Số serial Excel đại diện cho số ngày kể từ epoch, phần thập phân là thời gian trong ngày
      const dateValue = value - (value > 60 ? 1 : 0); // Điều chỉnh lỗi ngày 29/02/1900 của Excel
      const date = new Date(excelEpoch.getTime() + dateValue * millisecondsPerDay);

      if (!isNaN(date.getTime())) {
         // Điều chỉnh múi giờ nếu cần (Excel không lưu múi giờ)
         const timezoneOffset = date.getTimezoneOffset() * 60000;
         // Trả về Date object bao gồm cả giờ, phút, giây nếu có trong số serial
         return new Date(date.getTime() - timezoneOffset);
      }
    } catch (e) {
        console.warn("Lỗi khi parse số serial Excel:", value, e);
    }
  }

  // 3. Nếu là đối tượng Date sẵn rồi
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  console.warn("Không thể phân tích ngày/giờ:", value);
  return null; // Trả về null nếu không phân tích được
};

// Hàm lấy tên tháng và năm từ Date object
const getMonthYear = (date) => {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'Không xác định';
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${year}`;
};

// Hàm lấy ngày tháng năm từ Date object
const getDayMonthYear = (date) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return 'Không xác định';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// Hàm lấy ngày tháng năm giờ phút giây từ Date object
const getDateTimeString = (date) => {
    if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
};


// --- Component chính ---
function App() {
  const [rawData, setRawData] = useState([]); // Dữ liệu gốc từ Excel
  const [gridData, setGridData] = useState([]); // Dữ liệu hiển thị trên AG Grid (sau khi lọc)
  const [columnDefs, setColumnDefs] = useState([]); // Định nghĩa cột cho AG Grid
  const [fileName, setFileName] = useState(''); // Tên file đã tải lên
  const [isLoading, setIsLoading] = useState(false); // Trạng thái đang xử lý file
  const [error, setError] = useState(''); // Thông báo lỗi
  const [statistics, setStatistics] = useState(null); // Dữ liệu thống kê
  const [activeFilters, setActiveFilters] = useState({}); // Bộ lọc đang áp dụng
  const [showCharts, setShowCharts] = useState(true); // Ẩn/hiện biểu đồ

  const gridRef = useRef(); // Tham chiếu đến AG Grid API

  // Cấu hình mặc định cho các cột AG Grid
  const defaultColDef = useMemo(() => ({
    sortable: true,
    filter: true,
    resizable: true,
    floatingFilter: true, // Bật filter nổi trên header
    suppressMenu: true, // Ẩn menu cột mặc định (để đơn giản)
    minWidth: 100, // Chiều rộng tối thiểu cho cột
  }), []);

  // Hàm xử lý khi file được chọn
  const handleFileUpload = useCallback((event) => {
    const file = event.target.files[0];
    if (!file) return;

    setFileName(file.name);
    setIsLoading(true);
    setError('');
    setRawData([]);
    setGridData([]);
    setColumnDefs([]);
    setStatistics(null);
    setActiveFilters({});

    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        const data = e.target.result;
        // Thêm tùy chọn cellNF: false để SheetJS không tự định dạng số/ngày
        // Thêm dateNF để gợi ý định dạng ngày tháng nếu có
        const workbook = XLSX.read(data, {
            type: 'binary',
            cellDates: true, // Yêu cầu SheetJS cố gắng parse ngày
            cellNF: false, // Không sử dụng định dạng số của Excel
            // dateNF: 'dd/mm/yyyy\\ hh:mm:ss' // Gợi ý định dạng (có thể không cần thiết nếu cellDates=true hoạt động tốt)
         });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        // Sử dụng raw: true để lấy giá trị gốc, sau đó tự parse
        const jsonOpts = { header: 1, defval: '', raw: true };
        const jsonDataRaw = XLSX.utils.sheet_to_json(worksheet, jsonOpts);

        if (jsonDataRaw.length < 2) {
          throw new Error("File không có dữ liệu hoặc không có header.");
        }

        const headersRaw = jsonDataRaw[0]; // Header gốc
        const headersNormalized = headersRaw.map(normalizeHeader); // Header đã chuẩn hóa

        // Kiểm tra sơ bộ xem có các cột quan trọng không
        const missingHeaders = ['ngay_doi_soat', 'trang_thai', 'doanh_thu', 'phi_van_chuyen', 'ten_cua_hang', 'tinhthanh_pho_nguoi_nhan', 'nhan_vien_kinh_doanh', 'ngay_giao_thanh_cong', 'thoi_gian_tao']
                               .filter(h => !headersNormalized.includes(h));
        if (missingHeaders.length > 0) {
            console.warn(`Các cột sau có thể bị thiếu hoặc sai tên (đã chuẩn hóa): ${missingHeaders.join(', ')}. Một số thống kê/lọc có thể không hoạt động đúng.`);
        }

        // Tạo định nghĩa cột cho AG Grid và xử lý dữ liệu
        const cols = headersNormalized.map((headerNorm, index) => {
            const headerOriginal = headersRaw[index]; // Tên cột gốc để hiển thị
            const colDef = {
                headerName: headerOriginal,
                field: headerNorm,
                valueFormatter: undefined,
                filter: 'agTextColumnFilter', // Filter mặc định
                tooltipField: headerNorm,
                minWidth: 150, // Tăng chiều rộng mặc định
            };

            // Định dạng và filter cho các cột cụ thể
            const dateColumns = ['ngay_doi_soat', 'thoi_gian_tao', 'thoi_gian_lay_hang', 'ngay_xac_nhan_thu_tien', 'ngay_giao_thanh_cong'];
            const currencyColumns = ['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu'];
            const numberColumns = ['khoi_luong_khach_hang'];
            const setFilterColumns = ['trang_thai', 'tinhthanh_pho_nguoi_nhan', 'nhan_vien_kinh_doanh', 'ten_cua_hang', 'nhom_vung_mien', 'don_vi_van_chuyen', 'nguon_len_don'];

            if (dateColumns.includes(headerNorm)) {
                colDef.filter = 'agDateColumnFilter';
                colDef.filterParams = {
                    comparator: (filterLocalDateAtMidnight, cellValue) => {
                        // cellValue ở đây là Date object đã được parse trước đó
                        if (cellValue == null || !(cellValue instanceof Date)) return -1;

                        // So sánh chỉ phần ngày, bỏ qua giờ phút giây cho filter
                        const cellDateMidnight = new Date(cellValue);
                        cellDateMidnight.setHours(0, 0, 0, 0);

                        if (cellDateMidnight < filterLocalDateAtMidnight) return -1;
                        if (cellDateMidnight > filterLocalDateAtMidnight) return 1;
                        return 0;
                    },
                     browserDatePicker: true,
                     minValidYear: 2000,
                     maxValidYear: 2050,
                     buttons: ['reset', 'apply'],
                     // Định dạng ngày hiển thị trong filter popup
                     dateFormat: 'dd/mm/yyyy',
                };
                 // Hiển thị cả ngày và giờ nếu là cột thời gian
                 if (headerNorm.includes('thoi_gian') || headerNorm.includes('ngay_xac_nhan') || headerNorm.includes('ngay_giao_thanh_cong')) {
                     colDef.valueFormatter = params => getDateTimeString(params.value);
                     colDef.minWidth = 180; // Cần rộng hơn để hiển thị giờ
                 } else {
                     colDef.valueFormatter = params => getDayMonthYear(params.value); // Chỉ hiển thị ngày
                 }
                 colDef.cellDataType = 'dateString'; // Giúp AG Grid hiểu đây là ngày dạng chuỗi sau khi format
            } else if (currencyColumns.includes(headerNorm)) {
                colDef.filter = 'agNumberColumnFilter';
                colDef.type = 'numericColumn';
                colDef.valueFormatter = params => formatCurrency(params.value);
                colDef.cellDataType = 'number';
            } else if (numberColumns.includes(headerNorm)) {
                 colDef.filter = 'agNumberColumnFilter';
                 colDef.type = 'numericColumn';
                 colDef.cellDataType = 'number';
                 // Không cần valueFormatter nếu muốn giữ nguyên số gốc
            } else if (setFilterColumns.includes(headerNorm)) {
                 colDef.filter = 'agSetColumnFilter';
                 colDef.minWidth = 180; // Cột set filter thường cần rộng hơn
            } else {
                 colDef.cellDataType = 'text'; // Mặc định là text
            }

            return colDef;
        });

        // Chuyển đổi dữ liệu hàng
        const dataRows = jsonDataRaw.slice(1).map((row, rowIndex) => {
          const rowData = {};
          headersNormalized.forEach((headerNorm, index) => {
            let value = row[index]; // Lấy giá trị gốc (raw: true)

            // Parse ngày tháng sử dụng hàm parseDate đã cập nhật
            const dateColumns = ['ngay_doi_soat', 'thoi_gian_tao', 'thoi_gian_lay_hang', 'ngay_xac_nhan_thu_tien', 'ngay_giao_thanh_cong'];
            if (dateColumns.includes(headerNorm)) {
                value = parseDate(value); // Parse thành Date object
            }
            // Chuyển đổi số cho các cột tiền tệ và số lượng
            else if (['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu', 'khoi_luong_khach_hang'].includes(headerNorm)) {
                if (value === null || value === undefined || value === '') {
                    value = 0; // Hoặc null tùy logic
                } else if (typeof value === 'string') {
                    const cleanedValue = value.replace(/\./g, '').replace(/,/g, '.'); // Xử lý dấu phân cách
                    const num = parseFloat(cleanedValue);
                    value = isNaN(num) ? 0 : num;
                } else if (typeof value !== 'number') {
                    value = 0; // Hoặc null
                }
            }
            // Giữ nguyên các giá trị khác (text)
            else if (value === null || value === undefined) {
                value = ''; // Đảm bảo là chuỗi rỗng thay vì null/undefined
            } else {
                value = String(value); // Chuyển tất cả các giá trị khác thành chuỗi
            }

            rowData[headerNorm] = value;
          });
          rowData.id = rowIndex; // Thêm ID duy nhất
          return rowData;
        });

        setColumnDefs(cols);
        setRawData(dataRows);
        setGridData(dataRows);
        calculateStatistics(dataRows);

      } catch (err) {
        console.error("Lỗi xử lý file:", err);
        setError(`Lỗi xử lý file: ${err.message}. Vui lòng kiểm tra định dạng file và cấu trúc cột.`);
      } finally {
        setIsLoading(false);
        if (event.target) {
            event.target.value = null; // Reset input
        }
      }
    };

    reader.onerror = (err) => {
        console.error("Lỗi đọc file:", err);
        setError("Không thể đọc file. Vui lòng thử lại.");
        setIsLoading(false);
         if (event.target) {
            event.target.value = null; // Reset input
        }
    };

    reader.readAsBinaryString(file);
  }, []);

  // Hàm tính toán thống kê (Không thay đổi logic tính toán, chỉ đảm bảo dùng đúng field)
  const calculateStatistics = (data) => {
    if (!data || data.length === 0) {
      setStatistics(null);
      return;
    }

    const totalOrders = data.length;
    let totalRevenue = 0;
    let totalShippingFee = 0;
    const statusCounts = {};
    const storeCounts = {};
    const cityCounts = {};
    const salesRepCounts = {};
    const monthlyRevenue = {};
    const dailyOrders = {};

    data.forEach(row => {
      // Sử dụng tên field đã chuẩn hóa
      totalRevenue += Number(row.doanh_thu) || 0;
      totalShippingFee += Number(row.phi_van_chuyen) || 0;

      const status = row.trang_thai || 'Không xác định';
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const store = row.ten_cua_hang || 'Không xác định';
      storeCounts[store] = (storeCounts[store] || 0) + 1;

      const city = row.tinhthanh_pho_nguoi_nhan || 'Không xác định';
      cityCounts[city] = (cityCounts[city] || 0) + 1;

      const salesRep = row.nhan_vien_kinh_doanh || 'Không xác định';
      salesRepCounts[salesRep] = (salesRepCounts[salesRep] || 0) + 1;

      // Ưu tiên ngày giao thành công, fallback về ngày đối soát
      const relevantDate = row.ngay_giao_thanh_cong instanceof Date ? row.ngay_giao_thanh_cong : (row.ngay_doi_soat instanceof Date ? row.ngay_doi_soat : null);

      if (relevantDate) {
          const monthYear = getMonthYear(relevantDate);
          monthlyRevenue[monthYear] = (monthlyRevenue[monthYear] || 0) + (Number(row.doanh_thu) || 0);

          const dayMonthYear = getDayMonthYear(relevantDate);
          dailyOrders[dayMonthYear] = (dailyOrders[dayMonthYear] || 0) + 1;
      }
    });

    // Sắp xếp thống kê
    const sortedStatus = Object.entries(statusCounts).sort(([, a], [, b]) => b - a);
    const sortedStores = Object.entries(storeCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    const sortedCities = Object.entries(cityCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    const sortedSalesReps = Object.entries(salesRepCounts).sort(([, a], [, b]) => b - a).slice(0, 15);
    const sortedMonthlyRevenue = Object.entries(monthlyRevenue).sort(([a], [b]) => {
        const [m1, y1] = a.split('/');
        const [m2, y2] = b.split('/');
        if (!y1 || !m1 || !y2 || !m2) return 0; // Xử lý trường hợp 'Không xác định'
        return new Date(y1, m1 - 1) - new Date(y2, m2 - 1);
    });
     const sortedDailyOrders = Object.entries(dailyOrders).sort(([a], [b]) => {
        const [d1, m1, y1] = a.split('/');
        const [d2, m2, y2] = b.split('/');
         if (!y1 || !m1 || !d1 || !y2 || !m2 || !d2) return 0; // Xử lý trường hợp 'Không xác định'
        return new Date(y1, m1 - 1, d1) - new Date(y2, m2 - 1, d2);
    });


    setStatistics({
      totalOrders,
      totalRevenue,
      totalShippingFee,
      statusCounts: Object.fromEntries(sortedStatus),
      storeCounts: Object.fromEntries(sortedStores),
      cityCounts: Object.fromEntries(sortedCities),
      salesRepCounts: Object.fromEntries(sortedSalesReps),
      monthlyRevenue: Object.fromEntries(sortedMonthlyRevenue),
      dailyOrders: Object.fromEntries(sortedDailyOrders),
    });
  };

  // Hàm được gọi khi bộ lọc AG Grid thay đổi
  const onFilterChanged = useCallback(() => {
    if (gridRef.current && gridRef.current.api) {
      const filterModel = gridRef.current.api.getFilterModel();
      setActiveFilters(filterModel);

      const filteredData = [];
      gridRef.current.api.forEachNodeAfterFilter(node => filteredData.push(node.data));

      calculateStatistics(filteredData);
      // Không cần setGridData ở đây vì AG Grid tự xử lý hiển thị sau khi lọc
    }
  }, []);

   // Hàm reset tất cả bộ lọc
  const resetFilters = useCallback(() => {
    if (gridRef.current && gridRef.current.api) {
      gridRef.current.api.setFilterModel(null);
      setActiveFilters({});
      calculateStatistics(rawData); // Tính lại thống kê trên dữ liệu gốc
    }
  }, [rawData]);

  // Hàm xuất dữ liệu ra Excel (Cập nhật để lấy giá trị đã định dạng)
  const exportToExcel = useCallback(() => {
    if (!gridRef.current || !gridRef.current.api) return;

    const params = {
        fileName: `BaoCao_${new Date().toISOString().slice(0, 10)}.xlsx`,
        processCellCallback: (params) => {
            // Nếu là Date object, định dạng lại thành chuỗi dd/mm/yyyy hh:mm:ss hoặc dd/mm/yyyy
            const value = params.value;
            if (value instanceof Date) {
                 // Kiểm tra xem cột gốc có chứa 'thoi_gian' không để quyết định định dạng
                 const colId = params.column.getColId();
                 if (colId.includes('thoi_gian') || colId.includes('ngay_xac_nhan') || colId.includes('ngay_giao_thanh_cong')) {
                    return getDateTimeString(value);
                 } else {
                    return getDayMonthYear(value);
                 }
            }
            return value; // Giữ nguyên các giá trị khác
        }
    };
    gridRef.current.api.exportDataAsExcel(params);

  }, []);

   // Hàm xuất dữ liệu ra PDF (Cập nhật để xử lý định dạng)
  const exportToPdf = useCallback(() => {
    if (!gridRef.current || !gridRef.current.api) return;

    const doc = new jsPDF({ orientation: 'landscape' }); // Chuyển sang landscape cho rộng hơn
    const columnsToExport = columnDefs
      .filter(cd => cd.field && !['stt', 'sdt_nguoi_tao', 'dia_chi_nguoi_tao', 'phuongxa_tao', 'quanhuyen_tao', 'sdt_nguoi_gui_hang', 'dia_chi_nguoi_gui_hang', 'phuongxa_gui_hang', 'quanhuyen_gui_hang', 'sdt_nguoi_nhan', 'dia_chi_nguoi_nhan', 'phuongxa_nguoi_nhan', 'ghi_chu_giao_hang', 'ghi_chu_noi_bo', 'ghi_chu_cong_khai', 'tai_khoan_doi_tac', 'ma_don_doi_tac', 'ma_don_hang_mot_phan'].includes(cd.field)) // Lọc bớt cột
      .map(cd => ({ header: cd.headerName, dataKey: cd.field }));

    const tableRows = [];
    gridRef.current.api.forEachNodeAfterFilter(node => {
        const rowData = {};
         columnsToExport.forEach(col => {
            let value = node.data[col.dataKey];
             // Định dạng lại giá trị nếu cần
             if (value instanceof Date) {
                 // Dùng định dạng ngày hoặc ngày giờ tùy cột
                 if (col.dataKey.includes('thoi_gian') || col.dataKey.includes('ngay_xac_nhan') || col.dataKey.includes('ngay_giao_thanh_cong')) {
                     value = getDateTimeString(value);
                 } else {
                     value = getDayMonthYear(value);
                 }
             } else if (typeof value === 'number' && ['thu_ho', 'thu_ho_ban_dau', 'tri_gia', 'phi_van_chuyen', 'phi_doi_tac_thu', 'doanh_thu'].includes(col.dataKey)) {
                 value = formatCurrency(value); // Định dạng tiền tệ
             }
             // Chuyển thành chuỗi và loại bỏ dấu cho PDF
             value = value !== null && value !== undefined ? String(value) : '';
              rowData[col.dataKey] = value
                 .normalize("NFD")
                 .replace(/[\u0300-\u036f]/g, "")
                 .replace(/đ/g, "d").replace(/Đ/g, "D");
        });
        tableRows.push(rowData);
    });

     doc.setFont('helvetica');
     doc.text(`Bao cao don hang (${new Date().toLocaleDateString('vi-VN')})`, 14, 15);

    doc.autoTable({
        columns: columnsToExport,
        body: tableRows,
        startY: 20,
        theme: 'grid',
        styles: {
            font: 'helvetica',
            fontSize: 7, // Giảm cỡ chữ hơn nữa cho landscape
            cellPadding: 1,
            overflow: 'linebreak', // Tự động xuống dòng nếu text quá dài
        },
        headStyles: {
            fillColor: [22, 160, 133],
            textColor: 255,
            fontStyle: 'bold',
            fontSize: 8,
        },
        // Không cần didParseCell nữa vì đã xử lý trước đó
    });

    doc.save(`BaoCao_${new Date().toISOString().slice(0, 10)}.pdf`);
  }, [columnDefs]);


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
         <label htmlFor="fileInput" className="block text-lg font-semibold text-gray-700 mb-3">
           Chọn file Excel hoặc CSV:
         </label>
         <input
           type="file"
           id="fileInput"
           accept=".xlsx, .csv"
           onChange={handleFileUpload}
           className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 disabled:opacity-50 cursor-pointer"
           disabled={isLoading}
         />
         {fileName && !isLoading && <p className="text-sm text-gray-600 mt-2">Đã chọn file: {fileName}</p>}
         {isLoading && <p className="text-blue-600 mt-2 animate-pulse">Đang xử lý file, vui lòng đợi...</p>}
         {error && <p className="text-red-600 mt-2 font-semibold">{error}</p>}
       </div>

      {/* Khu vực hiển thị thống kê và biểu đồ */}
      {statistics && (
        <div className="mb-6">
           <div className="flex justify-between items-center mb-4">
             <h2 className="text-2xl font-semibold text-gray-800">Thống Kê Tổng Quan (Dựa trên dữ liệu đã lọc)</h2>
             <button
                onClick={() => setShowCharts(!showCharts)}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
             >
                {showCharts ? 'Ẩn Biểu Đồ' : 'Hiện Biểu Đồ'}
             </button>
           </div>

           {/* Các thẻ số liệu tổng quan */}
           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
             <div className="bg-white p-4 rounded-lg shadow border border-blue-100">
               <h3 className="text-sm font-medium text-blue-600">Tổng Số Đơn Hàng</h3>
               <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalOrders)}</p>
             </div>
             <div className="bg-white p-4 rounded-lg shadow border border-green-100">
               <h3 className="text-sm font-medium text-green-600">Tổng Doanh Thu</h3>
               <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalRevenue)} đ</p>
             </div>
             <div className="bg-white p-4 rounded-lg shadow border border-orange-100">
               <h3 className="text-sm font-medium text-orange-600">Tổng Phí Vận Chuyển</h3>
               <p className="text-2xl font-bold text-gray-800">{formatCurrency(statistics.totalShippingFee)} đ</p>
             </div>
           </div>

           {/* Khu vực biểu đồ (có thể ẩn/hiện) */}
           {showCharts && (
             <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
               {/* Biểu đồ Trạng thái đơn hàng */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Trạng Thái Đơn Hàng</h3>
                 <div style={{ height: '300px', position: 'relative' }}>
                   <Pie
                     data={{
                       labels: Object.keys(statistics.statusCounts),
                       datasets: [{
                         label: 'Số lượng',
                         data: Object.values(statistics.statusCounts),
                         backgroundColor: [
                           'rgba(54, 162, 235, 0.8)', 'rgba(255, 99, 132, 0.8)', 'rgba(75, 192, 192, 0.8)',
                           'rgba(255, 206, 86, 0.8)', 'rgba(153, 102, 255, 0.8)', 'rgba(255, 159, 64, 0.8)',
                           'rgba(99, 255, 132, 0.8)', 'rgba(201, 203, 207, 0.8)' // Thêm màu xám
                         ],
                         borderColor: 'rgba(255, 255, 255, 0.9)',
                         borderWidth: 1
                       }]
                     }}
                     options={{
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: {
                                position: 'right',
                                labels: { boxWidth: 12, padding: 15 } // Tùy chỉnh legend
                            },
                            tooltip: {
                                callbacks: {
                                    label: function(context) {
                                        let label = context.label || '';
                                        if (label) { label += ': '; }
                                        if (context.parsed !== null) {
                                            label += formatCurrency(context.parsed);
                                        }
                                        // Tính phần trăm
                                        const total = context.dataset.data.reduce((acc, value) => acc + value, 0);
                                        const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) + '%' : '0%';
                                        label += ` (${percentage})`;
                                        return label;
                                    }
                                }
                            }
                        }
                    }}
                   />
                 </div>
               </div>

               {/* Biểu đồ Doanh thu theo tháng */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Doanh Thu Theo Tháng</h3>
                  <div style={{ height: '300px', position: 'relative' }}>
                     <Line
                         data={{
                             labels: Object.keys(statistics.monthlyRevenue),
                             datasets: [{
                                 label: 'Doanh thu (VNĐ)',
                                 data: Object.values(statistics.monthlyRevenue),
                                 borderColor: 'rgb(75, 192, 192)',
                                 backgroundColor: 'rgba(75, 192, 192, 0.2)', // Giảm độ đậm màu nền
                                 tension: 0.1,
                                 fill: true,
                                 pointBackgroundColor: 'rgb(75, 192, 192)', // Màu điểm
                                 pointBorderColor: '#fff', // Viền điểm
                                 pointHoverBackgroundColor: '#fff', // Màu điểm khi hover
                                 pointHoverBorderColor: 'rgb(75, 192, 192)' // Viền điểm khi hover
                             }]
                         }}
                         options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            scales: {
                                y: {
                                    beginAtZero: true,
                                    ticks: { callback: value => formatCurrency(value) + ' đ' }
                                }
                            },
                            plugins: {
                                tooltip: {
                                    callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)} đ` }
                                }
                            }
                        }}
                     />
                 </div>
               </div>

                {/* Biểu đồ Số đơn theo ngày */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Số Đơn Theo Ngày</h3>
                  <div style={{ height: '300px', position: 'relative' }}>
                     <Line
                         data={{
                             labels: Object.keys(statistics.dailyOrders),
                             datasets: [{
                                 label: 'Số đơn',
                                 data: Object.values(statistics.dailyOrders),
                                 borderColor: 'rgb(255, 159, 64)',
                                 backgroundColor: 'rgba(255, 159, 64, 0.2)',
                                 tension: 0.1,
                                 fill: false,
                                 pointRadius: 2,
                                 pointBackgroundColor: 'rgb(255, 159, 64)',
                                 pointBorderColor: '#fff',
                                 pointHoverBackgroundColor: '#fff',
                                 pointHoverBorderColor: 'rgb(255, 159, 64)'
                             }]
                         }}
                         options={{
                             responsive: true,
                             maintainAspectRatio: false,
                             scales: { y: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } },
                             plugins: {
                                tooltip: {
                                    callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}` }
                                }
                            }
                          }}
                     />
                 </div>
               </div>


               {/* Biểu đồ Top Cửa hàng */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 Cửa Hàng (Số đơn)</h3>
                  <div style={{ height: '300px', position: 'relative' }}>
                    <Bar
                         data={{
                             labels: Object.keys(statistics.storeCounts),
                             datasets: [{
                                 label: 'Số đơn',
                                 data: Object.values(statistics.storeCounts),
                                 backgroundColor: 'rgba(153, 102, 255, 0.8)',
                                 borderColor: 'rgba(153, 102, 255, 1)',
                                 borderWidth: 1
                             }]
                         }}
                         options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` }
                                }
                            }
                         }}
                     />
                  </div>
               </div>

               {/* Biểu đồ Top Tỉnh/Thành phố */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 Tỉnh/Thành Phố (Số đơn)</h3>
                 <div style={{ height: '300px', position: 'relative' }}>
                     <Bar
                         data={{
                             labels: Object.keys(statistics.cityCounts),
                             datasets: [{
                                 label: 'Số đơn',
                                 data: Object.values(statistics.cityCounts),
                                 backgroundColor: 'rgba(54, 162, 235, 0.8)', // Đổi màu
                                  borderColor: 'rgba(54, 162, 235, 1)',
                                 borderWidth: 1
                             }]
                         }}
                         options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` }
                                }
                            }
                         }}
                     />
                 </div>
               </div>

                {/* Biểu đồ Top Nhân viên kinh doanh */}
               <div className="bg-white p-4 rounded-lg shadow border border-gray-100 min-h-[350px]">
                 <h3 className="text-lg font-semibold text-gray-700 mb-3">Top 15 NVKD (Số đơn)</h3>
                 <div style={{ height: '300px', position: 'relative' }}>
                     <Bar
                         data={{
                             labels: Object.keys(statistics.salesRepCounts),
                             datasets: [{
                                 label: 'Số đơn',
                                 data: Object.values(statistics.salesRepCounts),
                                 backgroundColor: 'rgba(255, 99, 132, 0.8)', // Đổi màu
                                 borderColor: 'rgba(255, 99, 132, 1)',
                                 borderWidth: 1
                             }]
                         }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            indexAxis: 'y',
                            scales: { x: { beginAtZero: true, ticks: { callback: value => formatCurrency(value) } } },
                            plugins: {
                                legend: { display: false },
                                tooltip: {
                                    callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.x)}` }
                                }
                            }
                         }}
                     />
                 </div>
               </div>
             </div>
            )}
        </div>
      )}

      {/* Khu vực bảng dữ liệu chi tiết và bộ lọc */}
      {columnDefs.length > 0 && (
        <div className="bg-white p-4 rounded-lg shadow border border-gray-200">
          <div className="flex justify-between items-center mb-4 flex-wrap gap-2">
            <h2 className="text-2xl font-semibold text-gray-800">Dữ Liệu Chi Tiết</h2>
            <div className="flex gap-2 flex-wrap">
               <button
                    onClick={resetFilters}
                    className="px-4 py-2 bg-yellow-500 text-white rounded-md hover:bg-yellow-600 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={Object.keys(activeFilters).length === 0}
                    title="Xóa tất cả bộ lọc đang áp dụng"
                >
                    Xóa Bộ Lọc
                </button>
              <button
                onClick={exportToExcel}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium shadow"
                title="Xuất dữ liệu đang hiển thị trong bảng ra file Excel"
              >
                Xuất Excel
              </button>
               <button
                onClick={exportToPdf}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 text-sm font-medium shadow"
                title="Xuất dữ liệu đang hiển thị trong bảng ra file PDF"
              >
                Xuất PDF
              </button>
            </div>
          </div>

           {/* Hiển thị bộ lọc đang áp dụng */}
          {Object.keys(activeFilters).length > 0 && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-700">
              <span className="font-semibold">Bộ lọc đang áp dụng:</span>
              <ul className="list-disc list-inside ml-4 mt-1 space-y-1">
                {Object.entries(activeFilters).map(([field, filter]) => {
                    let filterValue = '';
                    const headerName = columnDefs.find(c => c.field === field)?.headerName || field;
                    if (filter.filterType === 'text') {
                        filterValue = `${filter.type}: "${filter.filter}"`;
                    } else if (filter.filterType === 'number') {
                         filterValue = `${filter.type}: ${formatCurrency(filter.filter)}`; // Định dạng số trong filter
                    } else if (filter.filterType === 'set') {
                        filterValue = `Trong (${filter.values.slice(0, 5).join(', ')}${filter.values.length > 5 ? ', ...' : ''})`;
                    } else if (filter.filterType === 'date') {
                         const dateFrom = filter.dateFrom ? filter.dateFrom.split(' ')[0] : ''; // Chỉ lấy phần ngày
                         const dateTo = filter.dateTo ? filter.dateTo.split(' ')[0] : '';
                         filterValue = `${filter.type}: ${dateFrom}${dateTo ? ' đến ' + dateTo : ''}`;
                    } else {
                         filterValue = JSON.stringify(filter); // Fallback
                    }
                    return <li key={field}><span className='font-medium'>{headerName}:</span> {filterValue}</li>;
                })}
              </ul>
            </div>
          )}


          {/* AG Grid */}
          <div className="ag-theme-alpine" style={{ height: 600, width: '100%' }}>
            <AgGridReact
              ref={gridRef}
              rowData={gridData}
              columnDefs={columnDefs}
              defaultColDef={defaultColDef}
              pagination={true}
              paginationPageSize={100}
              animateRows={true}
              onFilterChanged={onFilterChanged}
              enableCellTextSelection={true}
              suppressExcelExport={true} // Tắt nút export mặc định của AG Grid, dùng nút tùy chỉnh
              tooltipShowDelay={300} // Giảm độ trễ tooltip
              rowSelection={'multiple'}
              // Tối ưu hóa
              suppressColumnVirtualisation={false}
              suppressRowVirtualisation={false}
              debounceVerticalScrollbar={true}
              // Tính năng bổ sung
              sideBar={true} // Bật sidebar để quản lý cột (ẩn/hiện, kéo thả)
              // Cung cấp dữ liệu cho AG Grid biết kiểu dữ liệu gốc (giúp lọc tốt hơn)
              onGridReady={params => {
                    // Có thể thực hiện các thao tác khác khi grid sẵn sàng
              }}
            />
          </div>
        </div>
      )}

        {/* Hướng dẫn sử dụng cơ bản */}
        {rawData.length === 0 && !isLoading && (
             <div className="mt-8 p-6 bg-gray-50 rounded-lg border border-gray-200">
                <h3 className="text-xl font-semibold text-gray-700 mb-3">Hướng dẫn nhanh</h3>
                <ol className="list-decimal list-inside space-y-2 text-gray-600">
                    <li>Nhấn nút "Chọn file Excel hoặc CSV" ở trên và chọn file dữ liệu đơn hàng của bạn (.xlsx hoặc .csv).</li>
                    <li>Đợi ứng dụng đọc và xử lý dữ liệu. Thời gian chờ tùy thuộc vào kích thước file và máy tính.</li>
                    <li>Sau khi xử lý xong, các biểu đồ thống kê và bảng dữ liệu chi tiết sẽ xuất hiện.</li>
                    <li>Sử dụng các ô lọc (ngay dưới tên cột) hoặc menu lọc (☰) trong bảng "Dữ Liệu Chi Tiết" để tìm kiếm và lọc.</li>
                    <li>Các biểu đồ và số liệu tổng quan sẽ tự động cập nhật theo bộ lọc bạn áp dụng.</li>
                    <li>Nhấn nút "Xóa Bộ Lọc" để quay lại xem toàn bộ dữ liệu.</li>
                    <li>Nhấn nút "Xuất Excel" hoặc "Xuất PDF" để tải về báo cáo với dữ liệu đang được hiển thị trong bảng.</li>
                </ol>
                <p className="mt-4 text-sm text-gray-500">Lưu ý: Xử lý file lớn (>100.000 dòng) trên trình duyệt có thể tốn tài nguyên. Nếu gặp lỗi hoặc treo, hãy thử lại với file nhỏ hơn hoặc đảm bảo máy tính đủ mạnh.</p>
             </div>
        )}

      <footer className="text-center mt-8 text-sm text-gray-500">
        {/* Thay đổi dòng này */}
        <p>Được tạo bởi Huy Nguyen. Sử dụng React, AG Grid, Chart.js, SheetJS, jsPDF.</p>
      </footer>
    </div>
  );
}

export default App;
