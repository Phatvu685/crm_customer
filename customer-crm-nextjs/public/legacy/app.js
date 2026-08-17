let customers = [];
let combos = [];
let accounts = [];
let expenses = [];
let products = [];
let stockEntries = [];
let custSeq = 1;
let comboSeq = 1;
let accountSeq = 1;
let expenseSeq = 1;
let productSeq = 1;
let stockSeq = 1;
let editingCustomerId = null;
let editingComboId = null;
// Các nhóm khách hàng (gộp nhiều đơn của cùng 1 khách) đang được mở rộng để xem chi tiết từng đơn
let expandedCustomerGroups = new Set();
let editingAccountId = null;
let editingExpenseId = null;
let editingProductId = null;
let editingStockId = null;
let transferCustomerId = null;
let currentExpenseType = 'chi_phi';
let currentStockType = 'nhap';
let pendingCustomerStage = 'order';

let users = [];
let currentUser = null;
// Map username -> id số (id thật trong DB) — chỉ admin nạp được (users.list() yêu cầu quyền admin).
// Dùng để chuyển đổi giá trị <select> (vốn dùng username làm value, giữ nguyên UI gốc)
// thành staffUserId (khoá ngoại số) khi gọi API tạo/sửa/chuyển giao khách hàng.
let userIdByUsername = {};

/* ================= LỚP ĐỒNG BỘ DỮ LIỆU VỚI BACKEND (API) =================
   Toàn bộ mảng customers/combos/products/stockEntries/expenses/accounts ở trên
   giờ đóng vai trò "cache cục bộ": sau khi đăng nhập, loadAllData() tải dữ liệu
   thật từ backend (NestJS + PostgreSQL) về, ánh xạ (map) sang đúng hình dạng mà
   toàn bộ hàm render...() bên dưới đang mong đợi — nhờ vậy KHÔNG cần sửa lại
   logic hiển thị, chỉ cần thay nguồn dữ liệu. Mọi thao tác THÊM/SỬA/XÓA giờ gọi
   CrmApi.* (xem api.js) rồi gọi lại loadAllData() để đồng bộ cache + vẽ lại UI. */

// ---- Các hàm map: dữ liệu backend trả về (JSON) -> đúng hình dạng field mà code gốc dùng ----
function mapProduct(p){
  return { id:p.id, name:p.name, unit:p.unit, minStock:Number(p.minStock)||0, sellPrice:Number(p.sellPrice)||0, note:p.note||'' };
}
function mapCombo(c){
  return {
    id:c.id, name:c.name, desc:c.desc||'',
    productId:c.productId||null,
    productName:c.productName || (c.product?c.product.name:'') || '',
    unit:c.unit||'kg',
    baseKg:Number(c.baseKg)||0, unitPrice:Number(c.unitPrice)||0,
    offerType:c.offerType||'percent', offerValue:Number(c.offerValue)||0,
    giftProductId:c.giftProductId||null, giftQty:Number(c.giftQty)||0,
  };
}
function mapStockEntry(s){
  return {
    id:s.id, type:s.type, productId:s.productId,
    qty:Number(s.qty)||0, unitPrice:Number(s.unitPrice)||0,
    supplier:s.supplier||'', date:s.date||'', note:s.note||'',
    expenseId: s.expense ? s.expense.id : null,
  };
}
function mapExpense(e){
  // Lưu ý: backend gọi field này là "kind", code gốc gọi là "type" — map lại cho khớp.
  return { id:e.id, type:e.kind, name:e.name, amount:Number(e.amount)||0, date:e.date||'', note:e.note||'', autoStock: !!e.autoStock };
}
function mapSocialAccount(a){
  return { id:a.id, resource:a.resource, username:a.username, password:a.password };
}
function mapCustomer(c){
  return {
    id:c.id, name:c.name, phone:c.phone||'', address:c.address||'', type:c.type, note:c.note||'',
    kg:Number(c.kg)||0, price:Number(c.price)||0,
    // Code gốc dùng "combo" như cờ 'co'/'khong' (không lưu tên), tách riêng khỏi "comboId"
    combo: c.comboId ? 'co' : 'khong',
    comboId: c.comboId || null,
    // Code gốc dùng "staff" là USERNAME (chuỗi), không phải id số -> lấy từ quan hệ staffUser
    staff: c.staffUser ? c.staffUser.username : (c.staffUserId ? String(c.staffUserId) : ''),
    productId: c.productId || null,
    stockEntryId: c.stockEntryId || null,
    giftStockEntryId: c.giftStockEntryId || null,
    giftProductId: c.giftProductId || null,
    stage: c.stage || 'order',
    paymentStatus: c.paymentStatus || 'da_tra',
    packed: !!c.packed, delivered: !!c.delivered,
    acquiredDate: c.acquiredDate || '', lastOrderDate: c.lastOrderDate || '',
    deliveryDate: c.deliveryDate || '', nextContactDate: c.nextContactDate || '',
    createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
  };
}

// Bảng tên hiển thị mặc định cho 5 tài khoản seed sẵn — user đăng ký mới (qua form
// "Đăng ký") sẽ được TỰ ĐỘNG thêm vào bảng này (dùng luôn username làm nhãn hiển thị)
// ngay trong loadAllData(), để giao diện không bao giờ hiện "undefined".
function mergeStaffLabel(usersList){
  (usersList||[]).forEach(u=>{
    if(!staffLabel[u.username]) staffLabel[u.username] = u.username;
  });
}

// ---- Tải TOÀN BỘ dữ liệu từ backend về, ánh xạ vào cache cục bộ, rồi vẽ lại mọi UI ----
async function loadAllData(){
  try{
    const isAdmin = currentUser && currentUser.role === 'admin';
    const results = await Promise.all([
      CrmApi.customers.list(),
      CrmApi.combos.list(),
      CrmApi.products.list(),
      CrmApi.stockEntries.list(),
      CrmApi.expenses.list(),
      CrmApi.socialAccounts.list(),
      // "directory" trả {id,username} cho MỌI role đã đăng nhập (không chỉ admin) —
      // dùng để dịch username <-> id và luôn hiển thị đúng tên nhân viên, kể cả tài
      // khoản vừa tự đăng ký mà chưa từng có admin nào tải danh sách này trước đó.
      CrmApi.users.directory(),
    ]);
    customers = results[0].map(mapCustomer);
    combos = results[1].map(mapCombo);
    products = results[2].map(mapProduct);
    stockEntries = results[3].map(mapStockEntry);
    expenses = results[4].map(mapExpense);
    accounts = results[5].map(mapSocialAccount);

    const directory = results[6] || [];
    userIdByUsername = {};
    directory.forEach(u=>{ userIdByUsername[u.username] = u.id; });
    mergeStaffLabel(directory);

    // Danh sách đầy đủ (kèm role) chỉ admin mới tải được — dùng khi cần (hiện chưa
    // có màn hình riêng quản lý tài khoản trong UI, nhưng giữ sẵn cho tương lai).
    if(isAdmin){
      try{ users = await CrmApi.users.list(); } catch(e){ /* bỏ qua nếu lỗi, không chặn app */ }
    }
  } catch(err){
    appAlert('Không tải được dữ liệu từ máy chủ: ' + err.message, {type:'danger', title:'Lỗi kết nối'});
    return;
  }
  populateProductSelects();
  populateComboSelect();
  populateStaffSelect();
  renderAccounts();
  renderCombos();
  renderWarehouse();
  render(); // renderCustomerList x2 + renderOrders + renderStats + renderCashflow + applyRolePermissions
}

// Chuyển "staff" (username, dùng trong <select>) -> staffUserId (số, dùng cho API).
// Nhân viên thường luôn map về CHÍNH id của họ (dropdown bị khoá vào bản thân họ).
function staffUsernameToId(username){
  if(!username) return null;
  if(currentUser && currentUser.role !== 'admin') return currentUser.id;
  return userIdByUsername[username] || null;
}

/* ================= FORM CẢNH BÁO / XÁC NHẬN DÙNG CHUNG ================= */
// Thay thế alert()/confirm() mặc định của trình duyệt bằng form cảnh báo
// đẹp, đồng bộ giao diện. Dùng cho: xóa dữ liệu, cảnh báo tồn kho không đủ,
// thiếu thông tin bắt buộc, và mọi thông báo quan trọng khác trong ứng dụng.
let _warnResolve = null;

function _showWarnModal({title, message, type='info', okText='Xác nhận', cancelText='Hủy', showCancel=true}){
  const icons = {danger:'🗑️', warning:'⚠️', info:'ℹ️', success:'✅'};
  const iconEl = document.getElementById('warnModalIcon');
  const okBtn = document.getElementById('warnModalOkBtn');
  const cancelBtn = document.getElementById('warnModalCancelBtn');
  const actions = document.getElementById('warnModalActions');
  const box = document.getElementById('warnModalBox');

  iconEl.textContent = icons[type] || icons.info;
  iconEl.className = 'warn-icon type-' + type;
  document.getElementById('warnModalTitle').textContent = title;
  document.getElementById('warnModalMessage').textContent = message;
  okBtn.textContent = okText;
  okBtn.className = 'type-' + type;
  cancelBtn.textContent = cancelText;
  cancelBtn.style.display = showCancel ? '' : 'none';
  actions.classList.toggle('single-action', !showCancel);

  box.classList.remove('shake');
  void box.offsetWidth; // reset animation
  document.getElementById('warnModalOverlay').classList.add('active');
  okBtn.focus();
}

function _closeWarnModal(){
  document.getElementById('warnModalOverlay').classList.remove('active');
}

// appAlert: thông báo đơn giản (chỉ 1 nút OK), trả về Promise khi người dùng bấm OK
function appAlert(message, opts={}){
  return new Promise(resolve=>{
    _showWarnModal({
      title: opts.title || 'Thông báo',
      message,
      type: opts.type || 'info',
      okText: opts.okText || 'Đã hiểu',
      showCancel: false,
    });
    _warnResolve = () => { resolve(); };
  });
}

// appConfirm: hỏi xác nhận (Hủy / Xác nhận), trả về Promise<boolean>
function appConfirm(message, opts={}){
  return new Promise(resolve=>{
    _showWarnModal({
      title: opts.title || (opts.type === 'danger' ? '⚠️ Xác nhận xóa' : 'Xác nhận'),
      message,
      type: opts.type || 'warning',
      okText: opts.okText || 'Xác nhận',
      cancelText: opts.cancelText || 'Hủy',
      showCancel: true,
    });
    _warnResolve = (ok) => { resolve(!!ok); };
  });
}

document.getElementById('warnModalOkBtn').addEventListener('click', ()=>{
  _closeWarnModal();
  const cb = _warnResolve; _warnResolve = null;
  if(cb) cb(true);
});
document.getElementById('warnModalCancelBtn').addEventListener('click', ()=>{
  _closeWarnModal();
  const cb = _warnResolve; _warnResolve = null;
  if(cb) cb(false);
});
document.getElementById('warnModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id !== 'warnModalOverlay') return;
  const box = document.getElementById('warnModalBox');
  box.classList.remove('shake');
  void box.offsetWidth;
  box.classList.add('shake');
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && document.getElementById('warnModalOverlay').classList.contains('active')){
    _closeWarnModal();
    const cb = _warnResolve; _warnResolve = null;
    if(cb) cb(false);
  }
});
/* ================= /FORM CẢNH BÁO ================= */

const typeLabel = {
  moi: {t:"Khách mới", c:"tag-new"},
  cu: {t:"Khách cũ", c:"tag-old"},
  tiemnang: {t:"Tiềm năng", c:"tag-lead"},
};
const staffLabel = {
  hai_em: "Hải Em",
  ngoc_thuong: "Ngọc Thương",
  ai_thi: "Ái Thi",
  tan_phat: "Tấn Phát",
};

function populateStaffSelect(){
  const sel = document.getElementById('cStaff');
  const current = sel.value;
  const isAdmin = currentUser && currentUser.role === 'admin';
  if(isAdmin){
    sel.innerHTML = `<option value="">— Chưa phân công —</option>` +
      Object.entries(staffLabel).map(([key,label])=>`<option value="${key}">${escapeHtml(label)}</option>`).join('');
    sel.disabled = false;
    sel.value = current;
  } else if(currentUser && staffLabel[currentUser.username]){
    // Nhân viên: chỉ thấy đúng tên của mình, không được chọn người khác
    sel.innerHTML = `<option value="${currentUser.username}">${escapeHtml(staffLabel[currentUser.username])}</option>`;
    sel.value = currentUser.username;
    sel.disabled = true;
  } else {
    sel.innerHTML = `<option value="">— Chưa phân công —</option>`;
    sel.disabled = true;
  }
}

function escapeHtml(s){
  const d = document.createElement('div');
  d.innerText = s;
  return d.innerHTML;
}
function formatVND(n){
  return Math.round(n).toLocaleString('vi-VN') + 'đ';
}
function formatDateVN(dateStr){
  if(!dateStr) return '';
  const [y,m,d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}
function formatDateTimeVN(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dateKeyFromTimestamp(ts){
  const d = new Date(ts);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function isPastDate(dateStr){
  if(!dateStr) return false;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr);
  return d < today;
}

// Khởi tạo giao diện ở trạng thái RỖNG trước khi đăng nhập (chưa có dữ liệu thật
// từ backend — dữ liệu thật chỉ được tải về qua loadAllData() SAU KHI đăng nhập
// thành công). 5 tài khoản mặc định (admin/hai_em/ngoc_thuong/ai_thi/tan_phat)
// đã được tạo sẵn trong database qua "npm run seed" ở phía backend.
function initEmptyUI(){
  populateProductSelects();
  populateComboSelect();
  renderAccounts();
  renderCashflow();
  renderWarehouse();
  render();
}

// ---- Các hàm thuần (pure) tính giá combo — vẫn dùng để hiển thị (renderCombos,
// xem trước combo trong form khách hàng...), hoạt động trên dữ liệu đã tải từ backend ----
function comboUnit(c){
  return c.unit || 'kg';
}
function comboBasePrice(c){
  return (Number(c.baseKg)||0) * (Number(c.unitPrice)||0);
}
function comboTotalKg(c){
  const base = Number(c.baseKg)||0;
  if(c.offerType === 'kg') return base + (Number(c.offerValue)||0);
  return base;
}
function comboFinalPrice(c){
  const base = comboBasePrice(c);
  const val = Number(c.offerValue)||0;
  if(c.offerType === 'percent') return Math.max(0, base * (1 - val/100));
  if(c.offerType === 'money') return Math.max(0, base - val);
  return base; // offerType === 'kg': giá không đổi, chỉ tặng thêm
}
function comboOfferLabel(c){
  const val = Number(c.offerValue)||0;
  const unit = comboUnit(c);
  let label = '—';
  if(c.offerType === 'percent') label = `🔻 Giảm ${val}%`;
  else if(c.offerType === 'kg') label = `🎁 Tặng thêm ${formatKg(val, unit)}`;
  else if(c.offerType === 'money') label = `💵 Trừ ${formatVND(val)}`;
  if(c.giftProductId && c.giftQty){
    const gp = products.find(x=>x.id===c.giftProductId);
    label += ` + 🎁 ${formatKg(c.giftQty, gp?gp.unit:'')} ${gp?escapeHtml(gp.name):''}`;
  }
  return label;
}
function formatKg(n, unit){
  n = Number(n)||0;
  unit = unit || 'kg';
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit}`;
}

function render(){
  renderCustomerList('order', 'custSearch','custFilterType','custFilterStaff','custCount','customerTableHolder', 'custFilterPayment','custFilterPacked','custFilterDelivered');
  renderCustomerList('cskh', 'cskhSearch','cskhFilterType','cskhFilterStaff','cskhCount','cskhTableHolder', 'cskhFilterPayment','cskhFilterPacked','cskhFilterDelivered');
  renderOrders();
  renderStats();
  renderCashflow();
  if(currentUser) applyRolePermissions();
}

// Ngày "thực" của đơn hàng: ưu tiên ngày đặt đơn / tiếp nhận do người dùng nhập,
// chỉ dùng createdAt (thời điểm tạo bản ghi trong hệ thống) khi không có ngày nào khác.
function getOrderDateKey(c){
  return c.lastOrderDate || c.acquiredDate || dateKeyFromTimestamp(c.createdAt || Date.now());
}

function renderOrders(){
  const holder = document.getElementById('orderTableHolder');
  if(!holder) return;

  const search = document.getElementById('orderSearch').value.trim().toLowerCase();
  const staffFilter = document.getElementById('orderFilterStaff').value;
  const paymentFilter = document.getElementById('orderFilterPayment').value;
  const fromDate = document.getElementById('orderFromDate').value;
  const toDate = document.getElementById('orderToDate').value;

  // Một "đơn hàng" là khách hàng đã có giá trị đơn (price > 0), bất kể đang ở giai đoạn Đơn hàng hay CSKH
  const allOrders = customers.filter(c=>c.price > 0);

  const todayKey = dateKeyFromTimestamp(Date.now());
  const todayCount = allOrders.filter(c=>getOrderDateKey(c) === todayKey).length;
  document.getElementById('orderTodayCount').textContent = `${todayCount} đơn`;

  const filtered = allOrders.filter(c=>{
    const matchSearch = !search || c.name.toLowerCase().includes(search) || c.phone.includes(search);
    const matchStaff = !staffFilter || (staffFilter === 'none' ? !c.staff : c.staff === staffFilter);
    const matchPayment = !paymentFilter || c.paymentStatus === paymentFilter;
    const orderDateKey = getOrderDateKey(c);
    const matchFrom = !fromDate || orderDateKey >= fromDate;
    const matchTo = !toDate || orderDateKey <= toDate;
    return matchSearch && matchStaff && matchPayment && matchFrom && matchTo;
  }).sort((a,b)=>getOrderDateKey(b).localeCompare(getOrderDateKey(a)) || (b.createdAt||0)-(a.createdAt||0));

  document.getElementById('orderFilteredCount').textContent = `${filtered.length} đơn`;
  document.getElementById('orderFilteredValue').textContent = formatVND(filtered.reduce((s,c)=>s+c.price,0));
  document.getElementById('orderCount').textContent = `${filtered.length} / ${allOrders.length} đơn hàng`;

  if(filtered.length === 0){
    holder.innerHTML = `<div class="empty">Không có đơn hàng nào khớp bộ lọc.</div>`;
    return;
  }

  holder.innerHTML = `<table>
    <thead><tr>
      <th>Ngày đặt đơn</th>
      <th>Khách hàng</th>
      <th>Sản phẩm / KL</th>
      <th>Giá trị</th>
      <th>Trạng thái</th>
      <th>Nhân viên</th>
    </tr></thead>
    <tbody>
      ${filtered.map(c=>{
        const product = c.productId ? products.find(p=>p.id===c.productId) : null;
        const payTag = c.paymentStatus === 'chua_tra'
          ? `<span class="tag tag-debt">🕒 Công nợ</span>`
          : `<span class="tag tag-revenue">✅ Đã thu</span>`;
        return `<tr>
          <td style="white-space:nowrap;">${formatDateVN(getOrderDateKey(c))}</td>
          <td>${escapeHtml(c.name)}<div class="contact-line">${escapeHtml(c.phone||'')}</div></td>
          <td>${product ? escapeHtml(product.name) : '—'}${c.kg ? ` — ${c.kg} ${product ? escapeHtml(product.unit) : 'kg'}` : ''}</td>
          <td style="white-space:nowrap;"><b>${formatVND(c.price)}</b></td>
          <td>${payTag}</td>
          <td>${c.staff ? escapeHtml(staffLabel[c.staff]) : '<span class="contact-line">—</span>'}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

async function toggleCustomerStage(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  const movingToOrder = c.stage === 'cskh'; // đang từ CSKH -> chuyển sang Đơn hàng
  try{ await CrmApi.customers.toggleStage(id); await loadAllData(); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(movingToOrder){
    // Tab "Đơn hàng" chỉ hiện khách đã có giá trị đơn (price > 0), nên khi vừa đánh dấu
    // "Đã phát sinh đơn" thì mở luôn form Sửa để nhập sản phẩm/số kg/giá tiền ngay —
    // nhờ vậy sau khi lưu, đơn sẽ xuất hiện ngay trong tab Đơn hàng thay vì phải vào sửa lại sau.
    appAlert(`Đã chuyển "${c.name}" sang Đơn hàng.\n\nVui lòng nhập sản phẩm, số lượng và giá tiền cho đơn này để nó hiện ra trong tab "Đơn hàng".`, {type:'success', title:'✅ Chuyển giao thành công'});
    startEditCustomer(id);
  }
}

// Khóa để gộp các đơn hàng của CÙNG 1 khách lại với nhau: ưu tiên theo SĐT, nếu không có SĐT thì theo tên+địa chỉ
function customerGroupKey(c){
  const phone = (c.phone||'').trim();
  if(phone) return 'p:'+phone;
  return 'n:'+(c.name||'').trim().toLowerCase()+'|'+(c.address||'').trim().toLowerCase();
}

function toggleCustomerGroup(key){
  if(expandedCustomerGroups.has(key)) expandedCustomerGroups.delete(key);
  else expandedCustomerGroups.add(key);
  render();
}

// Render 1 dòng <tr> cho 1 đơn hàng (dùng chung cho dòng đơn lẻ và dòng con khi mở rộng nhóm).
// compactIdentity=true: đây là dòng con trong 1 nhóm đã mở rộng -> không lặp lại tên/SĐT/địa chỉ nữa,
// thay vào đó hiển thị ngày giờ đặt đơn cụ thể để phân biệt các đơn với nhau.
function renderCustomerRow(c, stage, compactIdentity){
  const tp = typeLabel[c.type];
  const qtyInfo = c.kg ? `${c.kg} kg` : '—';
  const amountInfo = c.price ? formatVND(c.price) : '—';
  const paymentBadge = c.price
    ? (c.paymentStatus === 'chua_tra'
        ? `<span class="tag tag-debt" style="font-size:10px;">🕒 Công nợ</span>`
        : `<span class="tag tag-revenue" style="font-size:10px;">✅ Đã thu</span>`)
    : '<span class="contact-line">—</span>';
  const paymentToggleBtn = c.price
    ? `<button class="row-action" data-action="toggle-payment" data-id="${c.id}" title="Đổi trạng thái thanh toán" style="margin-top:4px;">🔄 Đổi</button>`
    : '';
  const packedBadge = c.packed
    ? `<span class="tag tag-revenue" style="font-size:10px;">📦 Đã đóng hàng</span>`
    : `<span class="tag tag-debt" style="font-size:10px;">📦 Chưa đóng hàng</span>`;
  const deliveredBadge = c.delivered
    ? `<span class="tag tag-revenue" style="font-size:10px;">🚚 Đã giao hàng</span>`
    : `<span class="tag tag-debt" style="font-size:10px;">🚚 Chưa giao hàng</span>`;
  const comboInfo = c.combo === 'co'
    ? `<div class="contact-line">🎁 ${escapeHtml(combos.find(x=>x.id===c.comboId)?.name || 'Combo đã xóa')}</div>`
    : '';
  const dateLines = [];
  if(c.acquiredDate) dateLines.push(`<div class="contact-line">Tiếp nhận: ${formatDateVN(c.acquiredDate)}</div>`);
  if(c.lastOrderDate) dateLines.push(`<div class="contact-line">Đặt đơn: ${formatDateVN(c.lastOrderDate)}</div>`);
  if(c.deliveryDate){
    const overdue = isPastDate(c.deliveryDate);
    dateLines.push(`<div class="contact-line${overdue?' date-overdue':''}">Giao hàng: ${formatDateVN(c.deliveryDate)}${overdue?' (quá hạn)':''}</div>`);
  }
  if(c.nextContactDate) dateLines.push(`<div class="contact-line">Liên hệ lại: ${formatDateVN(c.nextContactDate)}</div>`);
  const dateInfo = dateLines.length ? dateLines.join('') : '<span class="contact-line">—</span>';
  const stageToggleLabel = stage === 'cskh' ? '✅ Đã phát sinh đơn' : '🤝 Chuyển về CSKH';

  const createdLabel = formatDateTimeVN(c.createdAt);

  const identityCell = compactIdentity
    ? `<div class="contact-line">↳ Đặt lúc: <strong>${createdLabel}</strong></div>`
    : `
      <div><strong>${escapeHtml(c.name)}</strong></div>
      <div class="contact-line">${escapeHtml(c.phone||'—')}</div>
      <div class="contact-line">${escapeHtml(c.address||'')}</div>
    `;

  return `
  <tr${compactIdentity ? ' class="cust-subrow"' : ''}>
    <td>${identityCell}</td>
    <td style="white-space:nowrap;">
      <span class="tag ${tp.c}">${tp.t}</span>
      <button class="row-action stage-btn" data-action="toggle-stage" data-id="${c.id}" title="Đổi trạng thái chăm sóc">${stageToggleLabel}</button>
    </td>
    <td style="white-space:nowrap;">${c.staff ? escapeHtml(staffLabel[c.staff]) : '<span class="contact-line">—</span>'}</td>
    <td style="white-space:nowrap;">
      <div>${qtyInfo}</div>
      ${comboInfo}
    </td>
    <td style="white-space:nowrap;">${amountInfo}</td>
    <td style="white-space:nowrap;">
      <div>${paymentBadge}</div>
      ${paymentToggleBtn}
    </td>
    <td style="white-space:nowrap;">
      <span style="display:inline-block;vertical-align:top;text-align:center;">
        <div>${packedBadge}</div>
        <button class="row-action" data-action="toggle-packed" data-id="${c.id}" title="Đổi trạng thái đóng hàng">🔄 Đổi</button>
      </span>
      <span style="display:inline-block;vertical-align:top;text-align:center;margin-left:8px;">
        <div>${deliveredBadge}</div>
        <button class="row-action" data-action="toggle-delivered" data-id="${c.id}" title="Đổi trạng thái giao hàng">🔄 Đổi</button>
      </span>
    </td>
    <td>${dateInfo}</td>
    <td class="note-cell">${escapeHtml(c.note||'—')}</td>
    <td style="white-space:nowrap;">
      <button class="row-action" data-action="edit" data-id="${c.id}" title="Sửa">✏️</button>
      <button class="row-action" data-action="repeat" data-id="${c.id}" title="Khách mua lại — tạo đơn hàng mới, giữ nguyên đơn cũ">🔁</button>
      <button class="row-action" data-action="transfer" data-id="${c.id}" title="Chuyển giao cho nhân viên khác">🔄</button>
      <button class="row-action" data-action="delete" data-id="${c.id}" title="Xóa">🗑️</button>
    </td>
  </tr>`;
}

// Render 1 dòng "gộp" đại diện cho 1 khách có NHIỀU đơn hàng (thu gọn, bấm để xổ ra từng đơn)
function renderCustomerGroupHeaderRow(orders, stage, groupKey){
  const latest = orders[0]; // đơn mới nhất (đã sort giảm dần theo createdAt)
  const isOpen = expandedCustomerGroups.has(groupKey);
  const totalKg = orders.reduce((s,c)=>s+(Number(c.kg)||0), 0);
  const totalPrice = orders.reduce((s,c)=>s+(Number(c.price)||0), 0);
  const paidCount = orders.filter(c=>c.price && c.paymentStatus !== 'chua_tra').length;
  const debtCount = orders.filter(c=>c.price && c.paymentStatus === 'chua_tra').length;
  const packedCount = orders.filter(c=>c.packed).length;
  const deliveredCount = orders.filter(c=>c.delivered).length;
  const tp = typeLabel[latest.type];

  // Nếu các đơn trong nhóm do NHIỀU nhân viên khác nhau phụ trách, hiển thị rõ tất cả tên
  // (tránh hiểu lầm là khách "chuyển hẳn" sang người mới, mất phần của người cũ)
  const distinctStaff = Array.from(new Set(orders.map(c=>c.staff || '')));
  let staffCellHtml;
  if(distinctStaff.length <= 1){
    staffCellHtml = latest.staff ? escapeHtml(staffLabel[latest.staff]) : '<span class="contact-line">—</span>';
  } else {
    const names = distinctStaff.map(s=> s ? escapeHtml(staffLabel[s]) : 'Chưa phân công').join(', ');
    staffCellHtml = `<span class="tag tag-lead" style="font-size:10px;">👥 ${distinctStaff.length} NV</span><div class="contact-line">${names}</div>`;
  }

  return `
  <tr class="cust-grouprow">
    <td>
      <button class="row-action group-toggle-btn" data-action="toggle-group" data-key="${escapeHtml(groupKey)}" style="margin-right:6px;">${isOpen ? '▼' : '▶'}</button>
      <div style="display:inline-block;vertical-align:top;">
        <div><strong>${escapeHtml(latest.name)}</strong> <span class="tag tag-lead" style="font-size:10px;">🧾 ${orders.length} đơn</span></div>
        <div class="contact-line">${escapeHtml(latest.phone||'—')}</div>
        <div class="contact-line">${escapeHtml(latest.address||'')}</div>
      </div>
    </td>
    <td style="white-space:nowrap;"><span class="tag ${tp.c}">${tp.t}</span><div class="contact-line">Đơn gần nhất</div></td>
    <td style="white-space:nowrap;">${staffCellHtml}</td>
    <td style="white-space:nowrap;">Tổng: <strong>${totalKg} kg</strong></td>
    <td style="white-space:nowrap;">Tổng: <strong>${formatVND(totalPrice)}</strong></td>
    <td style="white-space:nowrap;">
      <div class="contact-line">✅ Đã thu: ${paidCount}</div>
      <div class="contact-line">🕒 Công nợ: ${debtCount}</div>
    </td>
    <td style="white-space:nowrap;">
      <div class="contact-line">📦 Đã đóng: ${packedCount}/${orders.length}</div>
      <div class="contact-line">🚚 Đã giao: ${deliveredCount}/${orders.length}</div>
    </td>
    <td class="contact-line">Đơn gần nhất: ${formatDateVN(getOrderDateKey(latest)) || '—'}</td>
    <td class="note-cell">—</td>
    <td style="white-space:nowrap;">
      <button class="row-action" data-action="repeat" data-id="${latest.id}" title="Thêm đơn hàng mới cho khách này">🔁 Mua lại</button>
    </td>
  </tr>`;
}

function renderCustomerList(stage, searchId, typeId, staffId, countId, holderId, paymentId, packedId, deliveredId){
  const search = document.getElementById(searchId).value.trim().toLowerCase();
  const filter = document.getElementById(typeId).value;
  const staffFilter = document.getElementById(staffId).value;
  const paymentFilter = paymentId ? document.getElementById(paymentId).value : '';
  const packedFilter = packedId ? document.getElementById(packedId).value : '';
  const deliveredFilter = deliveredId ? document.getElementById(deliveredId).value : '';
  let list = customers.filter(c=>{
    if((c.stage || 'order') !== stage) return false;
    const matchSearch = !search || c.name.toLowerCase().includes(search) || c.phone.includes(search);
    const matchFilter = !filter || c.type === filter;
    const matchStaff = !staffFilter || (staffFilter === 'none' ? !c.staff : c.staff === staffFilter);
    const matchPayment = !paymentFilter || c.paymentStatus === paymentFilter;
    const matchPacked = !packedFilter || (packedFilter === 'da' ? !!c.packed : !c.packed);
    const matchDelivered = !deliveredFilter || (deliveredFilter === 'da' ? !!c.delivered : !c.delivered);
    return matchSearch && matchFilter && matchStaff && matchPayment && matchPacked && matchDelivered;
  });

  const unitLabel = stage === 'cskh' ? 'khách CSKH' : 'khách hàng';
  const holder = document.getElementById(holderId);

  if(list.length === 0){
    document.getElementById(countId).textContent = `0 ${unitLabel}`;
    holder.innerHTML = `<div class="empty">${stage === 'cskh' ? 'Chưa có khách hàng nào đang chăm sóc.' : 'Chưa có khách hàng nào khớp bộ lọc.'}</div>`;
    return;
  }

  // Gộp các đơn của cùng 1 khách lại thành 1 nhóm, đơn mới nhất lên đầu
  const groupsMap = new Map();
  list.forEach(c=>{
    const key = stage+'::'+customerGroupKey(c);
    if(!groupsMap.has(key)) groupsMap.set(key, []);
    groupsMap.get(key).push(c);
  });
  const groups = Array.from(groupsMap.entries()).map(([key, orders])=>{
    orders.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return { key, orders };
  }).sort((ga,gb)=>(gb.orders[0].createdAt||0)-(ga.orders[0].createdAt||0));

  const groupCount = groups.length;
  document.getElementById(countId).textContent = groupCount !== list.length
    ? `${list.length} ${unitLabel} — ${groupCount} khách`
    : `${list.length} ${unitLabel}`;

  const rowsHtml = groups.map(({key, orders})=>{
    if(orders.length === 1) return renderCustomerRow(orders[0], stage, false);
    const headerRow = renderCustomerGroupHeaderRow(orders, stage, key);
    if(!expandedCustomerGroups.has(key)) return headerRow;
    const subRows = orders.map(c=>renderCustomerRow(c, stage, true)).join('');
    return headerRow + subRows;
  }).join('');

  holder.innerHTML = `
    <table>
      <thead><tr>
        <th>Khách hàng</th><th>Phân loại</th><th>Phụ trách</th><th>Số lượng</th><th>Số tiền</th><th>Trạng thái</th><th>Đóng hàng / Giao hàng</th><th>Mốc thời gian</th><th>Ghi chú</th><th>Thao tác</th>
      </tr></thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if(btn.dataset.action === 'toggle-group'){ toggleCustomerGroup(btn.dataset.key); return; }
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditCustomer(id);
      else if(btn.dataset.action === 'repeat') startRepeatOrder(id);
      else if(btn.dataset.action === 'transfer') openTransferModal(id);
      else if(btn.dataset.action === 'toggle-payment') togglePaymentStatus(id);
      else if(btn.dataset.action === 'toggle-packed') togglePackedStatus(id);
      else if(btn.dataset.action === 'toggle-delivered') toggleDeliveredStatus(id);
      else if(btn.dataset.action === 'toggle-stage') toggleCustomerStage(id);
      else deleteCustomer(id);
    });
  });
}

function renderCashflow(){
  if(!document.getElementById('cfRevenue')) return;

  const revenueEntries = customers
    .filter(c=>c.price && c.paymentStatus !== 'chua_tra')
    .map(c=>({
      id: 'cust-'+c.id, kind:'revenue', name: c.name, amount: c.price,
      date: c.lastOrderDate || c.acquiredDate || '', note: c.kg ? `${c.kg} kg — đã thu` : 'đã thu'
    }));
  const debtEntries = customers
    .filter(c=>c.price && c.paymentStatus === 'chua_tra')
    .map(c=>({
      id: 'debt-'+c.id, kind:'debt', name: c.name, amount: c.price,
      date: c.lastOrderDate || c.acquiredDate || '', note: c.kg ? `${c.kg} kg — công nợ` : 'công nợ', custId: c.id
    }));
  const expenseEntries = expenses.map(e=>({
    id: e.id, kind: e.type, name: e.name, amount: e.amount, date: e.date, note: e.note, autoStock: !!e.autoStock
  }));

  const totalRevenue = revenueEntries.reduce((s,e)=>s+e.amount,0);
  const totalDebt = debtEntries.reduce((s,e)=>s+e.amount,0);
  const totalExpense = expenses.filter(e=>e.type==='chi_phi').reduce((s,e)=>s+e.amount,0);
  const totalCapital = expenses.filter(e=>e.type==='von').reduce((s,e)=>s+e.amount,0);
  const totalRefund = expenses.filter(e=>e.type==='hoan_von').reduce((s,e)=>s+e.amount,0);
  const capitalOutstanding = totalCapital - totalRefund; // Vốn Đang Treo: phần vốn 4 người ứng ra mà công ty chưa hoàn lại
  // Lời/Lỗ không trừ "Hoàn vốn" vì đây chỉ là chuyển tiền trả lại người góp, không phải chi phí kinh doanh mới
  const profit = totalRevenue - totalExpense - totalCapital;

  document.getElementById('cfRevenue').textContent = formatVND(totalRevenue);
  document.getElementById('cfExpense').textContent = formatVND(totalExpense);
  document.getElementById('cfCapital').textContent = formatVND(capitalOutstanding);
  document.getElementById('cfCapitalDetail').textContent = `Đã bỏ ra: ${formatVND(totalCapital)} · Đã hoàn: ${formatVND(totalRefund)}`;
  document.getElementById('cfDebt').textContent = formatVND(totalDebt);
  const profitEl = document.getElementById('cfProfit');
  profitEl.textContent = (profit<0?'-':'') + formatVND(Math.abs(profit));
  profitEl.classList.remove('positive','negative');
  profitEl.classList.add(profit>=0?'positive':'negative');

  const allEntries = [...revenueEntries, ...debtEntries, ...expenseEntries].sort((a,b)=>{
    if(!a.date) return 1;
    if(!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  const search = document.getElementById('cfSearch').value.trim().toLowerCase();
  const kindFilter = document.getElementById('cfFilterKind').value;
  const fromDate = document.getElementById('cfFilterFrom').value;
  const toDate = document.getElementById('cfFilterTo').value;

  const filteredEntries = allEntries.filter(e=>{
    const matchSearch = !search || e.name.toLowerCase().includes(search) || (e.note||'').toLowerCase().includes(search);
    const matchKind = !kindFilter || e.kind === kindFilter;
    const matchFrom = !fromDate || (e.date && e.date >= fromDate);
    const matchTo = !toDate || (e.date && e.date <= toDate);
    return matchSearch && matchKind && matchFrom && matchTo;
  });

  document.getElementById('cfCount').textContent =
    `${filteredEntries.length} / ${allEntries.length} khoản mục (${revenueEntries.length} đã thu, ${debtEntries.length} công nợ, ${expenses.length} chi phí/vốn)`;

  const holder = document.getElementById('cashflowTableHolder');
  if(filteredEntries.length === 0){
    holder.innerHTML = `<div class="empty">Không có khoản mục nào khớp bộ lọc.</div>`;
    return;
  }

  const kindMeta = {
    revenue: {t:'Đã thu', c:'tag-revenue'},
    debt: {t:'Công nợ', c:'tag-debt'},
    chi_phi: {t:'Chi phí bán hàng', c:'tag-expense'},
    von: {t:'Vốn', c:'tag-capital'},
    hoan_von: {t:'Hoàn vốn', c:'tag-refund'},
  };

  holder.innerHTML = `
    <table>
      <thead><tr><th>Loại</th><th>Nội dung</th><th>Số tiền</th><th>Ngày</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${filteredEntries.map(e=>{
          const km = kindMeta[e.kind];
          const sign = (e.kind === 'revenue' || e.kind === 'debt') ? '+' : '-';
          const isExpenseEditable = (e.kind === 'chi_phi' || e.kind === 'von' || e.kind === 'hoan_von') && !e.autoStock;
          return `<tr>
            <td><span class="tag ${km.c}">${km.t}</span></td>
            <td>${escapeHtml(e.name)}</td>
            <td style="white-space:nowrap;">${sign}${formatVND(e.amount)}</td>
            <td>${e.date ? formatDateVN(e.date) : '—'}</td>
            <td class="note-cell">${escapeHtml(e.note||'—')}</td>
            <td>
              ${isExpenseEditable ? `
                <button class="row-action" data-action="edit" data-id="${e.id}" title="Sửa">✏️</button>
                <button class="row-action" data-action="delete" data-id="${e.id}" title="Xóa">🗑️</button>
              ` : e.kind === 'debt' ? `
                <button class="row-action" data-action="mark-paid" data-id="${e.custId}" title="Đánh dấu đã thu tiền">✅ Đã thu</button>
              ` : e.autoStock ? `
                <span class="contact-line" title="Sửa/xóa tại tab Kho hàng để giữ dữ liệu khớp nhau">🔒 Tự động (Kho hàng)</span>
              ` : `<span class="contact-line">tự động</span>`}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditExpense(id);
      else if(btn.dataset.action === 'delete') deleteExpense(id);
      else if(btn.dataset.action === 'mark-paid') markCustomerPaid(id);
    });
  });
}

async function markCustomerPaid(custId){
  try{ await CrmApi.customers.togglePayment(custId); await loadAllData(); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); }
}

function setExpenseType(type){
  currentExpenseType = type;
  document.getElementById('cfType').value = type;
  document.getElementById('cfTypeExpenseBtn').classList.toggle('active', type==='chi_phi');
  document.getElementById('cfTypeCapitalBtn').classList.toggle('active', type==='von');
  document.getElementById('cfTypeRefundBtn').classList.toggle('active', type==='hoan_von');
}

function openExpenseModal(){
  document.getElementById('expenseModalOverlay').classList.add('active');
}
function closeExpenseModal(){
  document.getElementById('expenseModalOverlay').classList.remove('active');
}

function startEditExpense(id){
  const e = expenses.find(x=>x.id===id);
  if(!e) return;
  if(e.autoStock){ appAlert('Khoản này được tự động tạo từ phiếu nhập kho. Vui lòng sửa tại tab Kho hàng để số liệu luôn khớp nhau.', {type:'info', title:'Không thể sửa'}); return; }
  editingExpenseId = id;
  openExpenseModal();
  setExpenseType(e.type);
  document.getElementById('cfName').value = e.name;
  document.getElementById('cfAmount').value = e.amount ? e.amount/1000 : '';
  document.getElementById('cfDate').value = e.date || '';
  document.getElementById('cfNote').value = e.note || '';
  document.getElementById('cfFormTitle').textContent = '✏️ Sửa khoản mục';
  document.getElementById('addExpenseBtn').textContent = 'Lưu thay đổi';
  document.getElementById('cancelExpenseEditBtn').style.display = 'block';
  document.getElementById('cfName').focus();
}

function resetExpenseForm(){
  editingExpenseId = null;
  setExpenseType('chi_phi');
  document.getElementById('cfName').value = '';
  document.getElementById('cfAmount').value = '';
  document.getElementById('cfDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('cfNote').value = '';
  document.getElementById('cfFormTitle').textContent = '💸 Thêm khoản chi phí / vốn';
  document.getElementById('addExpenseBtn').textContent = 'Lưu khoản mục';
  document.getElementById('cancelExpenseEditBtn').style.display = 'none';
}

async function deleteExpense(id){
  const e = expenses.find(x=>x.id===id);
  if(!e) return;
  if(e.autoStock){ appAlert('Khoản này được tự động tạo từ phiếu nhập kho. Vui lòng xóa phiếu kho tương ứng tại tab Kho hàng để số liệu luôn khớp nhau.', {type:'info', title:'Không thể xóa'}); return; }
  const ok = await appConfirm(`Xóa khoản mục "${e.name}"?`, {type:'danger', title:'⚠️ Xóa khoản mục'});
  if(!ok) return;
  try{ await CrmApi.expenses.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingExpenseId === id) resetExpenseForm();
  await loadAllData();
}

/* ===== Kho hàng ===== */

function populateProductSelects(){
  const whProduct = document.getElementById('whProduct');
  if(whProduct){
    const current = whProduct.value;
    whProduct.innerHTML = `<option value="">— Chọn sản phẩm —</option>` +
      products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('');
    whProduct.value = current;
  }
  const whFilterProduct = document.getElementById('whFilterProduct');
  if(whFilterProduct){
    const current = whFilterProduct.value;
    whFilterProduct.innerHTML = `<option value="">Tất cả sản phẩm</option>` +
      products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
    whFilterProduct.value = current;
  }
  populateComboProductSelect();
  const cProduct = document.getElementById('cProduct');
  if(cProduct){
    const current = cProduct.value;
    cProduct.innerHTML = `<option value="">— Không trừ kho —</option>` +
      products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('');
    cProduct.value = current;
  }
}

function getProductStock(productId){
  return stockEntries.filter(s=>s.productId===productId).reduce((sum,s)=>{
    return sum + (s.type === 'nhap' ? s.qty : -s.qty);
  }, 0);
}

// Tồn kho hiện tại của 1 sản phẩm, KHÔNG tính phiếu kho có id = excludeEntryId
// (dùng khi đang sửa khách hàng, để không tự trừ nhầm phiếu xuất cũ của chính khách đó)
function getProductStockExcluding(productId, excludeEntryId){
  return stockEntries.filter(s=>s.productId===productId && s.id!==excludeEntryId).reduce((sum,s)=>{
    return sum + (s.type === 'nhap' ? s.qty : -s.qty);
  }, 0);
}

// Kiểm tra tồn kho trước khi xuất bán cho khách. Nếu không đủ hàng, hỏi xác nhận;
// bấm OK thì vẫn cho lưu (kho sẽ bị âm), bấm Hủy thì dừng lại không lưu đơn.
async function confirmStockAvailability(productId, qty, excludeEntryId){
  productId = productId ? Number(productId) : null;
  qty = Number(qty) || 0;
  if(!productId || qty <= 0) return true;
  const p = products.find(x=>x.id===productId);
  if(!p) return true;
  const available = getProductStockExcluding(productId, excludeEntryId);
  if(available < qty){
    const afterMsg = available <= 0
      ? `Kho hàng sản phẩm "${p.name}" hiện đã hết (tồn kho: ${formatKg(available, p.unit)}).`
      : `Kho hàng sản phẩm "${p.name}" không đủ (tồn kho: ${formatKg(available, p.unit)}, cần xuất: ${formatKg(qty, p.unit)}).`;
    return await appConfirm(
      `${afterMsg}\n\nNếu bấm "Vẫn lưu đơn", đơn hàng vẫn được lưu và kho sẽ bị ÂM (${formatKg(available - qty, p.unit)}).\nBấm "Hủy" để dừng lại và không lưu đơn.`,
      {type:'warning', title:'⚠️ Không đủ hàng trong kho', okText:'Vẫn lưu đơn', cancelText:'Hủy'}
    );
  }
  return true;
}

function getLastImportUnitPrice(productId){
  const nhapEntries = stockEntries.filter(s=>s.productId===productId && s.type==='nhap' && s.qty>0 && s.unitPrice>0);
  if(nhapEntries.length === 0) return 0;
  const sorted = [...nhapEntries].sort((a,b)=>(a.date||'').localeCompare(b.date||'') || a.id-b.id);
  const last = sorted[sorted.length-1];
  return last.unitPrice / last.qty;
}

function renderWarehouse(){
  renderProducts();
  renderStockLedger();
  renderWarehouseStats();
}

function renderWarehouseStats(){
  if(!document.getElementById('whStatProducts')) return;
  document.getElementById('whStatProducts').textContent = products.length;
  const totalStock = products.reduce((s,p)=>s+getProductStock(p.id), 0);
  document.getElementById('whStatStock').textContent = totalStock.toLocaleString('vi-VN');
  const lowStockCount = products.filter(p=>getProductStock(p.id) < p.minStock).length;
  document.getElementById('whStatLow').textContent = lowStockCount;
  const totalValue = products.reduce((s,p)=>s + getProductStock(p.id) * getLastImportUnitPrice(p.id), 0);
  document.getElementById('whStatValue').textContent = formatVND(totalValue);
}

function renderProducts(){
  const holder = document.getElementById('productTableHolder');
  if(!holder) return;
  document.getElementById('productCount').textContent = `${products.length} sản phẩm`;
  if(products.length === 0){
    holder.innerHTML = `<div class="empty">Chưa có sản phẩm nào. Thêm sản phẩm đầu tiên bên trái.</div>`;
    return;
  }
  holder.innerHTML = `
    <table>
      <thead><tr><th>Sản phẩm</th><th>Đơn vị</th><th>Tồn kho</th><th>Tồn tối thiểu</th><th>Giá nhập gần nhất</th><th>Giá bán</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${products.map(p=>{
          const stock = getProductStock(p.id);
          const isLow = stock < p.minStock;
          const lastPrice = getLastImportUnitPrice(p.id);
          return `<tr>
            <td class="combo-row-name">${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.unit)}</td>
            <td class="${isLow?'stock-low':''}">${stock.toLocaleString('vi-VN')} ${escapeHtml(p.unit)}${isLow?' ⚠️':''}</td>
            <td>${p.minStock.toLocaleString('vi-VN')} ${escapeHtml(p.unit)}</td>
            <td>${lastPrice ? formatVND(lastPrice)+'/'+escapeHtml(p.unit) : '—'}</td>
            <td><b>${p.sellPrice ? formatVND(p.sellPrice)+'/'+escapeHtml(p.unit) : '—'}</b></td>
            <td class="note-cell">${escapeHtml(p.note||'—')}</td>
            <td style="white-space:nowrap;">
              <button class="row-action" data-action="edit" data-id="${p.id}" title="Sửa">✏️</button>
              <button class="row-action" data-action="delete" data-id="${p.id}" title="Xóa">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditProduct(id);
      else deleteProduct(id);
    });
  });
}

function openProductModal(){
  document.getElementById('productModalOverlay').classList.add('active');
}
function closeProductModal(){
  document.getElementById('productModalOverlay').classList.remove('active');
  resetProductForm();
}

function startEditProduct(id){
  const p = products.find(x=>x.id===id);
  if(!p) return;
  editingProductId = id;
  document.getElementById('pName').value = p.name;
  document.getElementById('pUnit').value = p.unit;
  document.getElementById('pMinStock').value = p.minStock || '';
  document.getElementById('pSellPrice').value = p.sellPrice ? p.sellPrice/1000 : '';
  document.getElementById('pNote').value = p.note || '';
  updatePSellPriceSuffix();
  document.getElementById('productFormTitle').textContent = '✏️ Sửa sản phẩm';
  document.getElementById('addProductBtn').textContent = 'Lưu thay đổi';
  openProductModal();
  document.getElementById('pName').focus();
}

function resetProductForm(){
  editingProductId = null;
  document.getElementById('pName').value = '';
  document.getElementById('pUnit').value = 'kg';
  document.getElementById('pMinStock').value = '';
  document.getElementById('pSellPrice').value = '';
  document.getElementById('pNote').value = '';
  updatePSellPriceSuffix();
  document.getElementById('productFormTitle').textContent = '🧺 Thêm sản phẩm';
  document.getElementById('addProductBtn').textContent = 'Lưu sản phẩm';
}

function updatePSellPriceSuffix(){
  const unit = document.getElementById('pUnit').value;
  document.getElementById('pSellPriceSuffix').textContent = `.000 đ/${unit}`;
}

async function deleteProduct(id){
  const p = products.find(x=>x.id===id);
  if(!p) return;
  const linkedEntries = stockEntries.filter(s=>s.productId===id);
  const linked = linkedEntries.length;
  const linkedCombos = combos.filter(c=>c.productId===id || c.giftProductId===id).length;
  const msgParts = [];
  if(linked>0) msgParts.push(`${linked} phiếu nhập/xuất kho (sẽ bị xóa luôn, kèm các khoản Vốn tương ứng bên Dòng tiền nếu có)`);
  if(linkedCombos>0) msgParts.push(`${linkedCombos} combo đang dùng sản phẩm này (combo sẽ mất liên kết sản phẩm, có thể tính giá/trừ kho sai)`);
  const msg = msgParts.length>0
    ? `Sản phẩm "${p.name}" đang gắn với ${msgParts.join(' và ')}. Vẫn xóa?`
    : `Xóa sản phẩm "${p.name}"?`;
  const ok = await appConfirm(msg, {type:'danger', title:'⚠️ Xóa sản phẩm'});
  if(!ok) return;
  try{ await CrmApi.products.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingProductId === id) resetProductForm();
  await loadAllData();
}

function setStockType(type){
  currentStockType = type;
  document.getElementById('whType').value = type;
  document.getElementById('whTypeNhapBtn').classList.toggle('active', type==='nhap');
  document.getElementById('whTypeXuatBtn').classList.toggle('active', type==='xuat');
  document.getElementById('whPriceLabel').textContent = type==='nhap' ? 'Tổng giá trị nhập' : 'Tổng giá trị xuất (không bắt buộc)';
  document.getElementById('whSupplierWrap').style.display = type==='nhap' ? 'block' : 'none';
}

function renderStockLedger(){
  const holder = document.getElementById('stockTableHolder');
  if(!holder) return;

  const search = document.getElementById('whSearch').value.trim().toLowerCase();
  const typeFilter = document.getElementById('whFilterType').value;
  const productFilter = document.getElementById('whFilterProduct').value;
  const fromDate = document.getElementById('whFilterFrom').value;
  const toDate = document.getElementById('whFilterTo').value;

  let list = stockEntries.filter(s=>{
    const p = products.find(x=>x.id===s.productId);
    const pname = p ? p.name.toLowerCase() : '';
    const matchSearch = !search || pname.includes(search) || (s.note||'').toLowerCase().includes(search) || (s.supplier||'').toLowerCase().includes(search);
    const matchType = !typeFilter || s.type === typeFilter;
    const matchProduct = !productFilter || s.productId === Number(productFilter);
    const matchFrom = !fromDate || (s.date && s.date >= fromDate);
    const matchTo = !toDate || (s.date && s.date <= toDate);
    return matchSearch && matchType && matchProduct && matchFrom && matchTo;
  }).sort((a,b)=>{
    if(!a.date) return 1;
    if(!b.date) return -1;
    return b.date.localeCompare(a.date) || b.id-a.id;
  });

  document.getElementById('whCount').textContent = `${list.length} / ${stockEntries.length} phiếu kho`;

  if(list.length === 0){
    holder.innerHTML = `<div class="empty">Không có phiếu kho nào khớp bộ lọc.</div>`;
    return;
  }

  holder.innerHTML = `
    <table>
      <thead><tr><th>Loại</th><th>Sản phẩm</th><th>Số lượng</th><th>Thành tiền</th><th>Ngày</th><th>Ghi chú</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${list.map(s=>{
          const p = products.find(x=>x.id===s.productId);
          const pname = p ? p.name : 'Sản phẩm đã xóa';
          const unit = p ? p.unit : '';
          const noteParts = [s.supplier, s.note].filter(Boolean);
          return `<tr>
            <td><span class="tag ${s.type==='nhap'?'tag-stock-in':'tag-stock-out'}">${s.type==='nhap'?'📥 Nhập kho':'📤 Xuất kho'}</span></td>
            <td>${escapeHtml(pname)}</td>
            <td style="white-space:nowrap;">${s.qty.toLocaleString('vi-VN')} ${escapeHtml(unit)}</td>
            <td style="white-space:nowrap;">${s.unitPrice ? formatVND(s.unitPrice) : '—'}</td>
            <td>${s.date ? formatDateVN(s.date) : '—'}</td>
            <td class="note-cell">${escapeHtml(noteParts.join(' — ') || '—')}</td>
            <td style="white-space:nowrap;">
              <button class="row-action" data-action="edit" data-id="${s.id}" title="Sửa">✏️</button>
              <button class="row-action" data-action="delete" data-id="${s.id}" title="Xóa">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditStockEntry(id);
      else deleteStockEntry(id);
    });
  });
}

function openStockModal(){
  document.getElementById('stockModalOverlay').classList.add('active');
}
function closeStockModal(){
  document.getElementById('stockModalOverlay').classList.remove('active');
  resetStockEntryForm();
}

function startEditStockEntry(id){
  const s = stockEntries.find(x=>x.id===id);
  if(!s) return;
  editingStockId = id;
  populateProductSelects();
  setStockType(s.type);
  document.getElementById('whProduct').value = s.productId;
  document.getElementById('whQty').value = s.qty || '';
  document.getElementById('whPrice').value = s.unitPrice ? s.unitPrice/1000 : '';
  document.getElementById('whSupplier').value = s.supplier || '';
  document.getElementById('whDate').value = s.date || '';
  document.getElementById('whNote').value = s.note || '';
  document.getElementById('whEntryFormTitle').textContent = '✏️ Sửa phiếu kho';
  document.getElementById('addStockEntryBtn').textContent = 'Lưu thay đổi';
  openStockModal();
  document.getElementById('whProduct').focus();
}

function resetStockEntryForm(){
  editingStockId = null;
  populateProductSelects();
  setStockType('nhap');
  document.getElementById('whProduct').value = '';
  document.getElementById('whQty').value = '';
  document.getElementById('whPrice').value = '';
  document.getElementById('whSupplier').value = '';
  document.getElementById('whDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('whNote').value = '';
  document.getElementById('whEntryFormTitle').textContent = '📥 Nhập / xuất kho';
  document.getElementById('addStockEntryBtn').textContent = 'Lưu phiếu';
}

async function deleteStockEntry(id){
  const s = stockEntries.find(x=>x.id===id);
  if(!s) return;
  const linkedCustomer = customers.find(cu=>cu.stockEntryId===id || cu.giftStockEntryId===id);
  const msg = linkedCustomer
    ? `Phiếu ${s.type==='nhap'?'nhập':'xuất'} kho này đang gắn với đơn hàng của khách "${linkedCustomer.name}". Xóa phiếu sẽ KHÔNG xóa đơn hàng của khách, chỉ làm mất phần trừ kho tương ứng (kho sẽ hiện dư nhiều hơn thực tế cho tới khi bạn sửa lại đơn hàng đó). Vẫn xóa?`
    : `Xóa phiếu ${s.type==='nhap'?'nhập':'xuất'} kho này?`;
  const ok = await appConfirm(msg, {type:'danger', title:'⚠️ Xóa phiếu kho'});
  if(!ok) return;
  try{ await CrmApi.stockEntries.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingStockId === id) resetStockEntryForm();
  await loadAllData();
}

/* ===== Xuất Excel ===== */

function downloadWorkbook(wb, filename){
  if(typeof XLSX === 'undefined'){
    appAlert('Không tải được thư viện xuất Excel. Vui lòng kiểm tra kết nối mạng và thử lại.', {type:'danger', title:'Lỗi xuất Excel'});
    return;
  }
  XLSX.writeFile(wb, filename);
}

function exportCashflowExcel(){
  const search = document.getElementById('cfSearch').value.trim().toLowerCase();
  const kindFilter = document.getElementById('cfFilterKind').value;
  const fromDate = document.getElementById('cfFilterFrom').value;
  const toDate = document.getElementById('cfFilterTo').value;

  const revenueEntries = customers
    .filter(c=>c.price && c.paymentStatus !== 'chua_tra')
    .map(c=>({ kind:'Đã thu', name: c.name, amount: c.price, date: c.lastOrderDate || c.acquiredDate || '', note: c.kg ? `${c.kg} kg — đã thu` : 'đã thu' }));
  const debtEntries = customers
    .filter(c=>c.price && c.paymentStatus === 'chua_tra')
    .map(c=>({ kind:'Công nợ', name: c.name, amount: c.price, date: c.lastOrderDate || c.acquiredDate || '', note: c.kg ? `${c.kg} kg — công nợ` : 'công nợ' }));
  const expenseEntries = expenses.map(e=>({
    kind: e.type==='chi_phi' ? 'Chi phí bán hàng' : (e.type==='hoan_von' ? 'Hoàn vốn' : 'Vốn'), name: e.name, amount: e.amount, date: e.date, note: e.note
  }));
  const kindRaw = { 'Đã thu':'revenue', 'Công nợ':'debt', 'Chi phí bán hàng':'chi_phi', 'Vốn':'von', 'Hoàn vốn':'hoan_von' };

  const allEntries = [...revenueEntries, ...debtEntries, ...expenseEntries].filter(e=>{
    const matchSearch = !search || e.name.toLowerCase().includes(search) || (e.note||'').toLowerCase().includes(search);
    const matchKind = !kindFilter || kindRaw[e.kind] === kindFilter;
    const matchFrom = !fromDate || (e.date && e.date >= fromDate);
    const matchTo = !toDate || (e.date && e.date <= toDate);
    return matchSearch && matchKind && matchFrom && matchTo;
  }).sort((a,b)=>{
    if(!a.date) return 1;
    if(!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  if(allEntries.length === 0){ appAlert('Không có khoản mục nào để xuất theo bộ lọc hiện tại.', {type:'info', title:'Không có dữ liệu'}); return; }

  const rows = allEntries.map(e=>({
    'Loại': e.kind,
    'Nội dung': e.name,
    'Số tiền (đ)': e.amount,
    'Ngày': e.date ? formatDateVN(e.date) : '',
    'Ghi chú': e.note || '',
  }));

  const totalRevenue = revenueEntries.reduce((s,e)=>s+e.amount,0);
  const totalDebt = debtEntries.reduce((s,e)=>s+e.amount,0);
  const totalExpense = expenses.filter(e=>e.type==='chi_phi').reduce((s,e)=>s+e.amount,0);
  const totalCapital = expenses.filter(e=>e.type==='von').reduce((s,e)=>s+e.amount,0);
  const totalRefund = expenses.filter(e=>e.type==='hoan_von').reduce((s,e)=>s+e.amount,0);
  const capitalOutstanding = totalCapital - totalRefund;
  const profit = totalRevenue - totalExpense - totalCapital;
  const summaryRows = [
    {'Chỉ tiêu':'Tổng doanh thu (đã thu)', 'Số tiền (đ)': totalRevenue},
    {'Chỉ tiêu':'Công nợ chưa thu', 'Số tiền (đ)': totalDebt},
    {'Chỉ tiêu':'Tổng chi phí bán hàng', 'Số tiền (đ)': totalExpense},
    {'Chỉ tiêu':'Vốn đã bỏ ra (tổng)', 'Số tiền (đ)': totalCapital},
    {'Chỉ tiêu':'Đã hoàn vốn', 'Số tiền (đ)': totalRefund},
    {'Chỉ tiêu':'Vốn Đang Treo (chưa hoàn)', 'Số tiền (đ)': capitalOutstanding},
    {'Chỉ tiêu':'Lời / Lỗ', 'Số tiền (đ)': profit},
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sổ dòng tiền');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Tổng hợp');
  const today = new Date().toISOString().slice(0,10);
  downloadWorkbook(wb, `dong-tien_${today}.xlsx`);
}

function exportWarehouseExcel(){
  const search = document.getElementById('whSearch').value.trim().toLowerCase();
  const typeFilter = document.getElementById('whFilterType').value;
  const productFilter = document.getElementById('whFilterProduct').value;
  const fromDate = document.getElementById('whFilterFrom').value;
  const toDate = document.getElementById('whFilterTo').value;

  let list = stockEntries.filter(s=>{
    const p = products.find(x=>x.id===s.productId);
    const pname = p ? p.name.toLowerCase() : '';
    const matchSearch = !search || pname.includes(search) || (s.note||'').toLowerCase().includes(search) || (s.supplier||'').toLowerCase().includes(search);
    const matchType = !typeFilter || s.type === typeFilter;
    const matchProduct = !productFilter || s.productId === Number(productFilter);
    const matchFrom = !fromDate || (s.date && s.date >= fromDate);
    const matchTo = !toDate || (s.date && s.date <= toDate);
    return matchSearch && matchType && matchProduct && matchFrom && matchTo;
  }).sort((a,b)=>{
    if(!a.date) return 1;
    if(!b.date) return -1;
    return b.date.localeCompare(a.date);
  });

  if(list.length === 0){ appAlert('Không có phiếu kho nào để xuất theo bộ lọc hiện tại.', {type:'info', title:'Không có dữ liệu'}); return; }

  const rows = list.map(s=>{
    const p = products.find(x=>x.id===s.productId);
    return {
      'Loại': s.type==='nhap' ? 'Nhập kho' : 'Xuất kho',
      'Sản phẩm': p ? p.name : 'Sản phẩm đã xóa',
      'Số lượng': s.qty,
      'Đơn vị': p ? p.unit : '',
      'Thành tiền (đ)': s.unitPrice || 0,
      'Ngày': s.date ? formatDateVN(s.date) : '',
      'Nhà cung cấp': s.supplier || '',
      'Ghi chú': s.note || '',
    };
  });

  const stockRows = products.map(p=>({
    'Sản phẩm': p.name,
    'Đơn vị': p.unit,
    'Tồn kho hiện tại': getProductStock(p.id),
    'Tồn tối thiểu': p.minStock,
    'Giá nhập gần nhất (đ)': getLastImportUnitPrice(p.id),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Sổ kho');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockRows), 'Tồn kho hiện tại');
  const today = new Date().toISOString().slice(0,10);
  downloadWorkbook(wb, `kho-hang_${today}.xlsx`);
}

function renderStats(){
  document.getElementById('statTotal').textContent = customers.length;
  document.getElementById('statCskh').textContent = customers.filter(c=>(c.stage||'order')==='cskh').length;
  document.getElementById('statOld').textContent = customers.filter(c=>c.type==='cu').length;
  document.getElementById('statLead').textContent = customers.filter(c=>c.type==='tiemnang').length;
}

function openCustomerModal(){
  document.getElementById('customerModalOverlay').classList.add('active');
}
function closeCustomerModal(){
  document.getElementById('customerModalOverlay').classList.remove('active');
  resetCustomerForm();
}

function openTransferModal(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  transferCustomerId = id;
  document.getElementById('transferCustName').textContent = `Khách hàng: ${c.name}`;
  document.getElementById('transferStaff').value = c.staff || '';
  document.getElementById('transferModalOverlay').classList.add('active');
}
function closeTransferModal(){
  transferCustomerId = null;
  document.getElementById('transferModalOverlay').classList.remove('active');
}

function startEditCustomer(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  editingCustomerId = id;
  document.getElementById('cName').value = c.name;
  document.getElementById('cPhone').value = c.phone;
  document.getElementById('cAddress').value = c.address;
  document.getElementById('cType').value = c.type;
  document.getElementById('cStage').value = c.stage || 'order';
  document.getElementById('cAcquiredDate').value = c.acquiredDate || '';
  document.getElementById('cLastOrderDate').value = c.lastOrderDate || '';
  document.getElementById('cDeliveryDate').value = c.deliveryDate || '';
  document.getElementById('cNextContactDate').value = c.nextContactDate || '';
  populateStaffSelect();
  if(currentUser && currentUser.role === 'admin') document.getElementById('cStaff').value = c.staff || '';
  document.getElementById('cNote').value = c.note;
  const presetKgs = ['5','10','15','20','25','30','40','50','100'];
  if(presetKgs.includes(String(c.kg))){
    document.getElementById('cKg').value = String(c.kg);
    document.getElementById('cKgCustom').style.display = 'none';
    document.getElementById('cKgCustom').value = '';
  } else {
    document.getElementById('cKg').value = 'custom';
    document.getElementById('cKgCustom').style.display = 'block';
    document.getElementById('cKgCustom').value = c.kg || '';
  }
  document.getElementById('cPrice').value = c.price ? c.price/1000 : '';
  document.getElementById('cPaymentStatus').value = c.paymentStatus || 'da_tra';
  populateProductSelects();
  document.getElementById('cProduct').value = c.productId || '';
  populateComboSelect();
  document.getElementById('cCombo').value = c.comboId || '';
  applyComboToCustomerForm();
  document.getElementById('custFormTitle').textContent = '✏️ Sửa khách hàng';
  document.getElementById('addCustomerBtn').textContent = 'Lưu thay đổi';
  document.getElementById('cancelEditBtn').style.display = 'block';
  openCustomerModal();
  document.getElementById('cName').focus();
}

// Khách cũ mua lại: tạo 1 ĐƠN HÀNG MỚI (dòng mới, KHÔNG ghi đè đơn cũ),
// tự điền sẵn tên/SĐT/địa chỉ/nhân viên phụ trách của khách, còn số lượng/sản phẩm/giá/ngày để trống cho đơn mới.
function startRepeatOrder(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  pendingCustomerStage = 'order';
  resetCustomerForm(); // đảm bảo editingCustomerId = null -> lưu sẽ tạo dòng mới, không sửa đơn cũ
  document.getElementById('cName').value = c.name;
  document.getElementById('cPhone').value = c.phone;
  document.getElementById('cAddress').value = c.address;
  document.getElementById('cType').value = 'cu'; // tự đánh dấu Khách cũ
  populateStaffSelect();
  document.getElementById('cStaff').value = c.staff || '';
  document.getElementById('custFormTitle').textContent = `🔁 Đơn hàng mới cho khách cũ: ${c.name}`;
  openCustomerModal();
  document.getElementById('cKgCustom').focus();
}

function resetCustomerForm(){
  editingCustomerId = null;
  document.getElementById('cName').value='';
  document.getElementById('cPhone').value='';
  document.getElementById('cAddress').value='';
  document.getElementById('cNote').value='';
  document.getElementById('cType').value='moi';
  document.getElementById('cStage').value = pendingCustomerStage;
  document.getElementById('cAcquiredDate').value = new Date().toISOString().slice(0,10);
  document.getElementById('cLastOrderDate').value='';
  document.getElementById('cDeliveryDate').value='';
  document.getElementById('cNextContactDate').value='';
  document.getElementById('cStaff').value='';
  populateStaffSelect();
  document.getElementById('cKg').value='25';
  document.getElementById('cKgCustom').value='';
  document.getElementById('cKgCustom').style.display='none';
  document.getElementById('cPrice').value='';
  document.getElementById('cPaymentStatus').value='da_tra';
  populateProductSelects();
  document.getElementById('cProduct').value='';
  document.getElementById('cCombo').value='';
  applyComboToCustomerForm();
  document.getElementById('custFormTitle').textContent = '👤 Thêm khách hàng';
  document.getElementById('addCustomerBtn').textContent = 'Lưu khách hàng';
  document.getElementById('cancelEditBtn').style.display = 'none';
}

function populateComboSelect(){
  const sel = document.getElementById('cCombo');
  const current = sel.value;
  sel.innerHTML = `<option value="">Không mua combo</option>` +
    combos.map(c=>`<option value="${c.id}">🎁 ${escapeHtml(c.name)} — ${formatVND(comboFinalPrice(c))} (${formatKg(comboTotalKg(c), comboUnit(c))})</option>`).join('');
  sel.value = current;
}

function renderCombos(){
  const holder = document.getElementById('comboTableHolder');
  document.getElementById('comboCount').textContent = `${combos.length} combo`;
  if(combos.length===0){
    holder.innerHTML = `<div class="empty">Chưa có combo nào. Tạo combo đầu tiên bên trái.</div>`;
    return;
  }
  holder.innerHTML = `
    <table>
      <thead><tr><th>Combo</th><th>Mô tả</th><th>Ưu đãi</th><th>Tổng kg</th><th>Giá gốc</th><th>Giá cuối</th><th>Đã mua bởi</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${combos.map(c=>{
          const boughtCount = customers.filter(cu=>cu.combo==='co' && cu.comboId===c.id).length;
          const offerLabel = comboOfferLabel(c);
          return `<tr>
            <td class="combo-row-name">${escapeHtml(c.name)}</td>
            <td class="note-cell" style="max-width:220px;">${escapeHtml(c.desc||'—')}</td>
            <td>${offerLabel}</td>
            <td>${formatKg(comboTotalKg(c), comboUnit(c))}</td>
            <td>${formatVND(comboBasePrice(c))}</td>
            <td><b>${formatVND(comboFinalPrice(c))}</b></td>
            <td>${boughtCount} khách</td>
            <td>
              <button class="row-action" data-action="edit" data-id="${c.id}" title="Sửa">✏️</button>
              <button class="row-action" data-action="delete" data-id="${c.id}" title="Xóa">🗑️</button>
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditCombo(id);
      else deleteCombo(id);
    });
  });
}

function openComboModal(){
  document.getElementById('comboModalOverlay').classList.add('active');
}
function closeComboModal(){
  document.getElementById('comboModalOverlay').classList.remove('active');
}

function startEditCombo(id){
  const c = combos.find(x=>x.id===id);
  if(!c) return;
  editingComboId = id;
  openComboModal();
  document.getElementById('koName').value = c.name;
  document.getElementById('koDesc').value = c.desc;
  document.getElementById('koProduct').value = c.productId || '';
  document.getElementById('koBaseKg').value = c.baseKg || '';
  document.getElementById('koUnitPrice').value = c.unitPrice ? c.unitPrice/1000 : '';
  document.getElementById('koOfferValue').value = c.offerType==='money' ? (c.offerValue ? c.offerValue/1000 : '') : (c.offerValue || '');
  document.getElementById('koGiftProduct').value = c.giftProductId || '';
  document.getElementById('koGiftQty').value = c.giftQty || '';
  document.getElementById('koGiftQtyWrap').style.display = c.giftProductId ? 'block' : 'none';
  updateComboUnitLabels();
  setComboOfferType(c.offerType || 'percent');
  document.getElementById('comboFormTitle').textContent = '✏️ Sửa combo';
  document.getElementById('addComboBtn').textContent = 'Lưu thay đổi';
  document.getElementById('cancelComboEditBtn').style.display = 'block';
  document.getElementById('koName').focus();
  updateComboCalc();
}

function resetComboForm(){
  editingComboId = null;
  document.getElementById('koName').value='';
  document.getElementById('koDesc').value='';
  document.getElementById('koProduct').value='';
  document.getElementById('koBaseKg').value='';
  document.getElementById('koUnitPrice').value='';
  document.getElementById('koOfferValue').value='';
  document.getElementById('koGiftProduct').value='';
  document.getElementById('koGiftQty').value='';
  document.getElementById('koGiftQtyWrap').style.display='none';
  updateComboUnitLabels();
  setComboOfferType('percent');
  document.getElementById('comboFormTitle').textContent = '🎁 Tạo combo ưu đãi';
  document.getElementById('addComboBtn').textContent = 'Lưu combo';
  document.getElementById('cancelComboEditBtn').style.display = 'none';
  updateComboCalc();
}

function populateComboProductSelect(){
  const sel = document.getElementById('koProduct');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = `<option value="">— Chọn sản phẩm trong kho —</option>` +
    products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('');
  sel.value = current;

  const giftSel = document.getElementById('koGiftProduct');
  if(giftSel){
    const giftCurrent = giftSel.value;
    giftSel.innerHTML = `<option value="">— Không có quà tặng kèm —</option>` +
      products.map(p=>`<option value="${p.id}">${escapeHtml(p.name)} (${escapeHtml(p.unit)})</option>`).join('');
    giftSel.value = giftCurrent;
  }
}

document.getElementById('koGiftProduct').addEventListener('change', ()=>{
  document.getElementById('koGiftQtyWrap').style.display =
    document.getElementById('koGiftProduct').value ? 'block' : 'none';
});

function updateComboUnitLabels(){
  const productId = Number(document.getElementById('koProduct').value)||0;
  const p = products.find(x=>x.id===productId);
  const unit = p ? p.unit : 'kg';
  document.getElementById('koUnitPriceSuffix').textContent = `.000 đ/${unit}`;
  const type = document.getElementById('koOfferType').value;
  if(type==='kg'){
    document.getElementById('koOfferValueLbl').textContent = `Giá trị ưu đãi (${unit})`;
    document.getElementById('koOfferValueSuffix').textContent = unit;
  }
}

function onComboProductChange(){
  const productId = Number(document.getElementById('koProduct').value)||0;
  const p = products.find(x=>x.id===productId);
  if(p){
    if(p.sellPrice){
      document.getElementById('koUnitPrice').value = Math.round(p.sellPrice/1000);
    }
  }
  updateComboUnitLabels();
  updateComboCalc();
}

function setComboOfferType(type){
  document.getElementById('koOfferType').value = type;
  document.querySelectorAll('#koOfferTypeBtns .btn').forEach(b=>{
    b.style.background = (b.dataset.offer===type) ? 'var(--accent)' : '';
    b.style.color = (b.dataset.offer===type) ? '#fff' : '';
  });
  const productId = Number(document.getElementById('koProduct').value)||0;
  const p = products.find(x=>x.id===productId);
  const unit = p ? p.unit : 'kg';
  const lbl = document.getElementById('koOfferValueLbl');
  const suffix = document.getElementById('koOfferValueSuffix');
  if(type==='percent'){ lbl.textContent='Giá trị ưu đãi (%)'; suffix.textContent='%'; }
  else if(type==='kg'){ lbl.textContent=`Giá trị ưu đãi (${unit})`; suffix.textContent=unit; }
  else { lbl.textContent='Giá trị ưu đãi (tiền)'; suffix.textContent='.000 đ'; }
  updateComboCalc();
}

function updateComboCalc(){
  const productId = Number(document.getElementById('koProduct').value)||0;
  const p = products.find(x=>x.id===productId);
  const unit = p ? p.unit : 'kg';
  const baseKg = Number(document.getElementById('koBaseKg').value)||0;
  const unitPrice = (Number(document.getElementById('koUnitPrice').value)||0) * 1000;
  const offerType = document.getElementById('koOfferType').value;
  const rawVal = Number(document.getElementById('koOfferValue').value)||0;
  const offerValue = offerType==='money' ? rawVal*1000 : rawVal;
  const tmp = { baseKg, unitPrice, offerType, offerValue, unit };
  document.getElementById('koCalcBase').textContent = formatVND(comboBasePrice(tmp));
  document.getElementById('koCalcKg').textContent = formatKg(comboTotalKg(tmp), unit);
  document.getElementById('koCalcFinal').textContent = formatVND(comboFinalPrice(tmp));
}

async function deleteCombo(id){
  const c = combos.find(x=>x.id===id);
  if(!c) return;
  const linked = customers.filter(cu=>cu.combo==='co' && cu.comboId===id).length;
  const msg = linked>0
    ? `Combo "${c.name}" đang gắn với ${linked} khách hàng. Xóa vẫn giữ khách hàng nhưng mất liên kết combo. Vẫn xóa?`
    : `Xóa combo "${c.name}"?`;
  const ok = await appConfirm(msg, {type:'danger', title:'⚠️ Xóa combo'});
  if(!ok) return;
  try{ await CrmApi.combos.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingComboId === id) resetComboForm();
  await loadAllData();
}

async function togglePaymentStatus(id){
  try{ await CrmApi.customers.togglePayment(id); await loadAllData(); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); }
}

async function togglePackedStatus(id){
  try{ await CrmApi.customers.togglePacked(id); await loadAllData(); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); }
}

async function toggleDeliveredStatus(id){
  try{ await CrmApi.customers.toggleDelivered(id); await loadAllData(); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); }
}

async function deleteCustomer(id){
  const c = customers.find(x=>x.id===id);
  if(!c) return;
  const ok = await appConfirm(`Xóa khách hàng "${c.name}"?`, {type:'danger', title:'⚠️ Xóa khách hàng'});
  if(!ok) return;
  try{ await CrmApi.customers.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingCustomerId === id) resetCustomerForm();
  await loadAllData();
}

function renderAccounts(){
  const holder = document.getElementById('accountTableHolder');
  document.getElementById('accountCount').textContent = `${accounts.length} tài khoản`;
  if(accounts.length===0){
    holder.innerHTML = `<div class="empty">Chưa có tài khoản nào. Thêm tài khoản đầu tiên bên trái.</div>`;
    return;
  }
  holder.innerHTML = `
    <table>
      <thead><tr><th>Tên tài nguyên</th><th>Tên ĐN</th><th>Mật khẩu</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${accounts.map(a=>`
          <tr>
            <td><span class="tag tag-lead">${escapeHtml(a.resource)}</span></td>
            <td>${escapeHtml(a.username)}</td>
            <td class="pw-cell">${escapeHtml(a.password)}</td>
            <td>
              <button class="row-action" data-action="edit" data-id="${a.id}" title="Sửa">✏️</button>
              <button class="row-action" data-action="delete" data-id="${a.id}" title="Xóa">🗑️</button>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
  `;
  holder.querySelectorAll('.row-action').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = Number(btn.dataset.id);
      if(btn.dataset.action === 'edit') startEditAccount(id);
      else deleteAccount(id);
    });
  });
}

function openAccountModal(){
  document.getElementById('accountModalOverlay').classList.add('active');
}
function closeAccountModal(){
  document.getElementById('accountModalOverlay').classList.remove('active');
}

function startEditAccount(id){
  const a = accounts.find(x=>x.id===id);
  if(!a) return;
  editingAccountId = id;
  openAccountModal();
  const presetResources = ['EMAIL','FACEBOOK','ZALO','SP EXPRESS','SHOPEE','TIKTOK','WEBSITE'];
  if(presetResources.includes(a.resource)){
    document.getElementById('acName').value = a.resource;
    document.getElementById('acNameCustom').style.display = 'none';
  } else {
    document.getElementById('acName').value = 'KHAC';
    document.getElementById('acNameCustom').style.display = 'block';
    document.getElementById('acNameCustom').value = a.resource;
  }
  document.getElementById('acUser').value = a.username;
  document.getElementById('acPass').value = a.password;
  document.getElementById('accountFormTitle').textContent = '✏️ Sửa tài khoản';
  document.getElementById('addAccountBtn').textContent = 'Lưu thay đổi';
  document.getElementById('cancelAccountEditBtn').style.display = 'block';
  document.getElementById('acUser').focus();
}

function resetAccountForm(){
  editingAccountId = null;
  document.getElementById('acName').value = 'EMAIL';
  document.getElementById('acNameCustom').value = '';
  document.getElementById('acNameCustom').style.display = 'none';
  document.getElementById('acUser').value = '';
  document.getElementById('acPass').value = '';
  document.getElementById('accountFormTitle').textContent = '🔑 Thêm tài khoản';
  document.getElementById('addAccountBtn').textContent = 'Lưu tài khoản';
  document.getElementById('cancelAccountEditBtn').style.display = 'none';
}

async function deleteAccount(id){
  const a = accounts.find(x=>x.id===id);
  if(!a) return;
  const ok = await appConfirm(`Xóa tài khoản "${a.resource} — ${a.username}"?`, {type:'danger', title:'⚠️ Xóa tài khoản'});
  if(!ok) return;
  try{ await CrmApi.socialAccounts.remove(id); }
  catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi'}); return; }
  if(editingAccountId === id) resetAccountForm();
  await loadAllData();
}

document.getElementById('addCustomerBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('cName').value.trim();
  const phone = document.getElementById('cPhone').value.trim();
  const address = document.getElementById('cAddress').value.trim();
  const type = document.getElementById('cType').value;
  const stage = document.getElementById('cStage').value;
  const staff = document.getElementById('cStaff').value;
  const note = document.getElementById('cNote').value.trim();
  const productId = document.getElementById('cProduct').value ? Number(document.getElementById('cProduct').value) : null;
  const kgSelect = document.getElementById('cKg').value;
  const kg = kgSelect === 'custom' ? (document.getElementById('cKgCustom').value || 0) : kgSelect;
  const price = (document.getElementById('cPrice').value || 0) * 1000;
  const paymentStatus = document.getElementById('cPaymentStatus').value;
  const comboId = document.getElementById('cCombo').value ? Number(document.getElementById('cCombo').value) : null;
  const combo = comboId ? 'co' : 'khong';
  const acquiredDate = document.getElementById('cAcquiredDate').value;
  const lastOrderDate = document.getElementById('cLastOrderDate').value;
  const deliveryDate = document.getElementById('cDeliveryDate').value;
  const nextContactDate = document.getElementById('cNextContactDate').value;

  if(!name){ appAlert('Vui lòng nhập tên khách hàng.', {type:'warning', title:'Thiếu thông tin'}); return; }

  // Kiểm tra tồn kho trước khi lưu: nếu không đủ hàng thì hỏi xác nhận (Vẫn lưu = kho âm; Hủy = dừng lại)
  {
    const editingCust = editingCustomerId ? customers.find(x=>x.id===editingCustomerId) : null;
    const excludeMainId = editingCust ? editingCust.stockEntryId : null;
    if(!(await confirmStockAvailability(productId, kg, excludeMainId))) return;

    const comboForStock = comboId ? combos.find(x=>x.id===comboId) : null;
    if(comboForStock && comboForStock.giftProductId && comboForStock.giftQty){
      const excludeGiftId = editingCust ? editingCust.giftStockEntryId : null;
      if(!(await confirmStockAvailability(comboForStock.giftProductId, comboForStock.giftQty, excludeGiftId))) return;
    }
  }

  // Chuyển "staff" (username hiển thị trong <select>) -> staffUserId (khoá ngoại số) cho API
  const staffUserId = staffUsernameToId(staff);

  // Lưu ý: comboId/staffUserId/productId gửi ĐÚNG giá trị (number HOẶC null) —
  // KHÔNG đổi null thành undefined, vì null nghĩa là "bỏ chọn/xoá liên kết",
  // còn undefined nghĩa là "không đổi gì" — 2 ý nghĩa khác nhau khi SỬA khách hàng.
  const payload = {
    name, phone, address, type, stage, note,
    kg: Number(kg)||0,
    price: Number(price)||0,
    comboId: comboId,
    staffUserId: staffUserId,
    productId: productId,
    paymentStatus,
    acquiredDate: acquiredDate || undefined,
    lastOrderDate: lastOrderDate || undefined,
    deliveryDate: deliveryDate || undefined,
    nextContactDate: nextContactDate || undefined,
  };

  try{
    if(editingCustomerId){
      await CrmApi.customers.update(editingCustomerId, payload);
    } else {
      await CrmApi.customers.create(payload);
    }
  } catch(err){
    appAlert(err.message, {type:'danger', title:'Lỗi lưu khách hàng'});
    return;
  }
  resetCustomerForm();
  closeCustomerModal();
  await loadAllData();
});

document.getElementById('openAddCustomerBtn').addEventListener('click', ()=>{
  pendingCustomerStage = 'order';
  resetCustomerForm();
  openCustomerModal();
});
document.getElementById('openAddCskhBtn').addEventListener('click', ()=>{
  pendingCustomerStage = 'cskh';
  resetCustomerForm();
  openCustomerModal();
});
document.getElementById('closeCustomerModal').addEventListener('click', closeCustomerModal);
document.getElementById('customerModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'customerModalOverlay') closeCustomerModal();
});

document.getElementById('cKg').addEventListener('change', ()=>{
  document.getElementById('cKgCustom').style.display =
    document.getElementById('cKg').value === 'custom' ? 'block' : 'none';
  updateAutoPriceFromProduct();
});
document.getElementById('cKgCustom').addEventListener('input', updateAutoPriceFromProduct);
document.getElementById('cProduct').addEventListener('change', updateAutoPriceFromProduct);

function updateAutoPriceFromProduct(){
  const comboId = document.getElementById('cCombo').value;
  if(comboId) return; // giá đã được tự tính theo combo, không ghi đè
  const productId = document.getElementById('cProduct').value ? Number(document.getElementById('cProduct').value) : null;
  if(!productId) return;
  const p = products.find(x=>x.id===productId);
  if(!p || !p.sellPrice) return;
  const kgSelect = document.getElementById('cKg').value;
  const kg = Number(kgSelect === 'custom' ? (document.getElementById('cKgCustom').value || 0) : kgSelect) || 0;
  if(kg <= 0) return;
  document.getElementById('cPrice').value = Math.round((p.sellPrice * kg) / 1000);
}

function applyComboToCustomerForm(){
  const comboId = document.getElementById('cCombo').value ? Number(document.getElementById('cCombo').value) : null;
  const productSelect = document.getElementById('cProduct');
  const kgSelect = document.getElementById('cKg');
  const kgCustom = document.getElementById('cKgCustom');
  const priceInput = document.getElementById('cPrice');
  const hint = document.getElementById('cComboHint');
  if(comboId){
    const c = combos.find(x=>x.id===comboId);
    if(c){
      const totalKg = comboTotalKg(c);
      const finalPrice = comboFinalPrice(c);
      if(c.productId) productSelect.value = String(c.productId);
      kgSelect.value = 'custom';
      kgCustom.style.display = 'block';
      kgCustom.value = totalKg;
      priceInput.value = Math.round(finalPrice/1000);
      productSelect.disabled = true;
      kgSelect.disabled = true;
      kgCustom.disabled = true;
      priceInput.disabled = true;
      hint.style.display = 'block';
      hint.textContent = `${comboOfferLabel(c)} — tự động điền theo combo "${c.name}"` +
        (c.giftProductId ? ` (kho sẽ tự trừ thêm quà tặng kèm khi lưu)` : '');
      return;
    }
  }
  productSelect.disabled = false;
  kgSelect.disabled = false;
  kgCustom.disabled = false;
  priceInput.disabled = false;
  hint.style.display = 'none';
  hint.textContent = '';
  updateAutoPriceFromProduct();
}

document.getElementById('cCombo').addEventListener('change', applyComboToCustomerForm);

document.getElementById('cancelEditBtn').addEventListener('click', closeCustomerModal);
document.getElementById('custSearch').addEventListener('input', render);
document.getElementById('custFilterType').addEventListener('change', render);
document.getElementById('custFilterStaff').addEventListener('change', render);
document.getElementById('custFilterPayment').addEventListener('change', render);
document.getElementById('custFilterPacked').addEventListener('change', render);
document.getElementById('custFilterDelivered').addEventListener('change', render);
document.getElementById('cskhSearch').addEventListener('input', render);
document.getElementById('cskhFilterType').addEventListener('change', render);
document.getElementById('cskhFilterStaff').addEventListener('change', render);
document.getElementById('cskhFilterPayment').addEventListener('change', render);
document.getElementById('cskhFilterPacked').addEventListener('change', render);
document.getElementById('cskhFilterDelivered').addEventListener('change', render);

document.getElementById('orderSearch').addEventListener('input', render);
document.getElementById('orderFilterStaff').addEventListener('change', render);
document.getElementById('orderFilterPayment').addEventListener('change', render);
document.getElementById('orderFromDate').addEventListener('change', render);
document.getElementById('orderToDate').addEventListener('change', render);
document.getElementById('orderTodayBtn').addEventListener('click', ()=>{
  const todayKey = dateKeyFromTimestamp(Date.now());
  document.getElementById('orderFromDate').value = todayKey;
  document.getElementById('orderToDate').value = todayKey;
  render();
});
document.getElementById('orderClearFilterBtn').addEventListener('click', ()=>{
  document.getElementById('orderSearch').value = '';
  document.getElementById('orderFilterPayment').value = '';
  document.getElementById('orderFromDate').value = '';
  document.getElementById('orderToDate').value = '';
  if(!document.getElementById('orderFilterStaff').disabled) document.getElementById('orderFilterStaff').value = '';
  render();
});

document.querySelectorAll('.tab').forEach(tab=>{
  tab.addEventListener('click', ()=>{
    document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('view-'+tab.dataset.view).classList.add('active');
  });
});

document.getElementById('addComboBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('koName').value.trim();
  const desc = document.getElementById('koDesc').value.trim();
  const productId = Number(document.getElementById('koProduct').value)||0;
  const product = products.find(x=>x.id===productId);
  const unit = product ? product.unit : 'kg';
  const baseKg = Number(document.getElementById('koBaseKg').value)||0;
  const unitPrice = (Number(document.getElementById('koUnitPrice').value)||0) * 1000;
  const offerType = document.getElementById('koOfferType').value;
  const rawVal = Number(document.getElementById('koOfferValue').value)||0;
  const offerValue = offerType==='money' ? rawVal*1000 : rawVal;
  const giftProductId = Number(document.getElementById('koGiftProduct').value)||0;
  const giftQty = giftProductId ? (Number(document.getElementById('koGiftQty').value)||0) : 0;

  if(!name || !productId || !baseKg || !unitPrice){ appAlert('Vui lòng nhập tên combo, chọn sản phẩm, số lượng gốc và đơn giá.', {type:'warning', title:'Thiếu thông tin'}); return; }

  const payload = { name, desc, productId, unit, baseKg, unitPrice, offerType, offerValue, giftProductId: giftProductId||null, giftQty };
  try{
    if(editingComboId) await CrmApi.combos.update(editingComboId, payload);
    else await CrmApi.combos.create(payload);
  } catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi lưu combo'}); return; }
  resetComboForm();
  closeComboModal();
  await loadAllData();
});
document.getElementById('cancelComboEditBtn').addEventListener('click', closeComboModal);

document.getElementById('openAddComboBtn').addEventListener('click', ()=>{
  if(products.length === 0){
    appAlert('Kho hàng chưa có sản phẩm nào.\n\nCombo ưu đãi cần dựa trên 1 sản phẩm có sẵn trong kho (kèm đơn giá) để tính giá gốc, nên bạn cần vào tab "📦 Kho hàng" thêm ít nhất 1 sản phẩm (VD: Gạo ST25, giá bán...) trước khi tạo combo.\n\nHệ thống sẽ tự chuyển bạn sang tab Kho hàng ngay bây giờ.', {type:'warning', title:'Chưa có sản phẩm'});
    document.getElementById('warehouseTab').click();
    return;
  }
  resetComboForm();
  openComboModal();
});
document.getElementById('closeComboModal').addEventListener('click', closeComboModal);
document.getElementById('comboModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'comboModalOverlay') closeComboModal();
});

document.querySelectorAll('#koOfferTypeBtns .btn').forEach(btn=>{
  btn.addEventListener('click', ()=> setComboOfferType(btn.dataset.offer));
});
document.getElementById('koProduct').addEventListener('change', onComboProductChange);
['koBaseKg','koUnitPrice','koOfferValue'].forEach(id=>{
  document.getElementById(id).addEventListener('input', updateComboCalc);
});

document.getElementById('openAddProductBtn').addEventListener('click', ()=>{
  resetProductForm();
  openProductModal();
});
document.getElementById('closeProductModal').addEventListener('click', closeProductModal);
document.getElementById('productModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'productModalOverlay') closeProductModal();
});

document.getElementById('addProductBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('pName').value.trim();
  const unit = document.getElementById('pUnit').value;
  const minStock = Number(document.getElementById('pMinStock').value) || 0;
  const sellPrice = (Number(document.getElementById('pSellPrice').value) || 0) * 1000;
  const note = document.getElementById('pNote').value.trim();
  if(!name){ appAlert('Vui lòng nhập tên sản phẩm.', {type:'warning', title:'Thiếu thông tin'}); return; }

  const payload = { name, unit, minStock, sellPrice, note };
  try{
    if(editingProductId) await CrmApi.products.update(editingProductId, payload);
    else await CrmApi.products.create(payload);
  } catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi lưu sản phẩm'}); return; }
  resetProductForm();
  closeProductModal();
  await loadAllData();
});
document.getElementById('pUnit').addEventListener('change', updatePSellPriceSuffix);
document.getElementById('cancelProductEditBtn').addEventListener('click', closeProductModal);

document.getElementById('openAddStockBtn').addEventListener('click', ()=>{
  resetStockEntryForm();
  openStockModal();
});
document.getElementById('closeStockModal').addEventListener('click', closeStockModal);
document.getElementById('stockModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'stockModalOverlay') closeStockModal();
});

document.getElementById('whTypeNhapBtn').addEventListener('click', ()=>setStockType('nhap'));
document.getElementById('whTypeXuatBtn').addEventListener('click', ()=>setStockType('xuat'));

document.getElementById('addStockEntryBtn').addEventListener('click', async ()=>{
  const type = document.getElementById('whType').value;
  const productId = document.getElementById('whProduct').value;
  const qty = Number(document.getElementById('whQty').value) || 0;
  const unitPrice = (document.getElementById('whPrice').value || 0) * 1000;
  const supplier = document.getElementById('whSupplier').value.trim();
  const date = document.getElementById('whDate').value;
  const note = document.getElementById('whNote').value.trim();

  if(!productId){ appAlert('Vui lòng chọn sản phẩm.', {type:'warning', title:'Thiếu thông tin'}); return; }
  if(!qty){ appAlert('Vui lòng nhập số lượng.', {type:'warning', title:'Thiếu thông tin'}); return; }
  if(type === 'xuat'){
    const currentStock = getProductStock(Number(productId));
    const editingQty = editingStockId ? (stockEntries.find(x=>x.id===editingStockId)?.type === 'xuat' ? stockEntries.find(x=>x.id===editingStockId).qty : 0) : 0;
    if(qty > currentStock + editingQty){
      const ok = await appConfirm(
        `Tồn kho hiện chỉ còn ${(currentStock+editingQty).toLocaleString('vi-VN')}. Vẫn tiếp tục xuất ${qty.toLocaleString('vi-VN')}?`,
        {type:'warning', title:'⚠️ Không đủ hàng trong kho', okText:'Vẫn xuất kho', cancelText:'Hủy'}
      );
      if(!ok) return;
    }
  }

  const payload = { type, productId: Number(productId), qty, unitPrice: Number(unitPrice), supplier, date, note };
  try{
    if(editingStockId) await CrmApi.stockEntries.update(editingStockId, payload);
    else await CrmApi.stockEntries.create(payload);
  } catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi lưu phiếu kho'}); return; }
  resetStockEntryForm();
  closeStockModal();
  await loadAllData();
});
document.getElementById('cancelStockEditBtn').addEventListener('click', closeStockModal);
document.getElementById('whSearch').addEventListener('input', renderStockLedger);
document.getElementById('whFilterType').addEventListener('change', renderStockLedger);
document.getElementById('whFilterProduct').addEventListener('change', renderStockLedger);
document.getElementById('whFilterFrom').addEventListener('change', renderStockLedger);
document.getElementById('whFilterTo').addEventListener('change', renderStockLedger);
document.getElementById('exportWhExcelBtn').addEventListener('click', exportWarehouseExcel);

document.getElementById('exportCfExcelBtn').addEventListener('click', exportCashflowExcel);
document.getElementById('cfTodayBtn').addEventListener('click', ()=>{
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('cfFilterFrom').value = today;
  document.getElementById('cfFilterTo').value = today;
  renderCashflow();
});

document.getElementById('acName').addEventListener('change', ()=>{
  document.getElementById('acNameCustom').style.display =
    document.getElementById('acName').value === 'KHAC' ? 'block' : 'none';
});

document.getElementById('addAccountBtn').addEventListener('click', async ()=>{
  const nameSel = document.getElementById('acName').value;
  const resource = nameSel === 'KHAC' ? document.getElementById('acNameCustom').value.trim() : nameSel;
  const username = document.getElementById('acUser').value.trim();
  const password = document.getElementById('acPass').value.trim();
  if(!resource || !username || !password){ appAlert('Vui lòng nhập đầy đủ tên tài nguyên, tên đăng nhập và mật khẩu.', {type:'warning', title:'Thiếu thông tin'}); return; }

  const payload = { resource, username, password };
  try{
    if(editingAccountId) await CrmApi.socialAccounts.update(editingAccountId, payload);
    else await CrmApi.socialAccounts.create(payload);
  } catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi lưu tài khoản'}); return; }
  resetAccountForm();
  closeAccountModal();
  await loadAllData();
});
document.getElementById('cancelAccountEditBtn').addEventListener('click', closeAccountModal);

document.getElementById('openAddAccountBtn').addEventListener('click', ()=>{
  resetAccountForm();
  openAccountModal();
});
document.getElementById('closeAccountModal').addEventListener('click', closeAccountModal);
document.getElementById('accountModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'accountModalOverlay') closeAccountModal();
});

document.getElementById('cfTypeExpenseBtn').addEventListener('click', ()=>setExpenseType('chi_phi'));
document.getElementById('cfTypeCapitalBtn').addEventListener('click', ()=>setExpenseType('von'));
document.getElementById('cfTypeRefundBtn').addEventListener('click', ()=>setExpenseType('hoan_von'));

document.getElementById('addExpenseBtn').addEventListener('click', async ()=>{
  const type = document.getElementById('cfType').value;
  const name = document.getElementById('cfName').value.trim();
  const amount = (Number(document.getElementById('cfAmount').value) || 0) * 1000;
  const date = document.getElementById('cfDate').value;
  const note = document.getElementById('cfNote').value.trim();
  if(!name || !amount){ appAlert('Vui lòng nhập tên khoản mục và số tiền.', {type:'warning', title:'Thiếu thông tin'}); return; }

  // Lưu ý: backend gọi field này là "kind", frontend gọi là "type" -> đổi tên khi gửi lên API
  const payload = { kind: type, name, amount: Number(amount), date, note };
  try{
    if(editingExpenseId) await CrmApi.expenses.update(editingExpenseId, payload);
    else await CrmApi.expenses.create(payload);
  } catch(err){ appAlert(err.message, {type:'danger', title:'Lỗi lưu khoản mục'}); return; }
  resetExpenseForm();
  closeExpenseModal();
  await loadAllData();
});
document.getElementById('cancelExpenseEditBtn').addEventListener('click', closeExpenseModal);

document.getElementById('openAddExpenseBtn').addEventListener('click', ()=>{
  resetExpenseForm();
  openExpenseModal();
});
document.getElementById('closeExpenseModal').addEventListener('click', closeExpenseModal);
document.getElementById('expenseModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'expenseModalOverlay') closeExpenseModal();
});
document.getElementById('cfSearch').addEventListener('input', renderCashflow);
document.getElementById('cfFilterKind').addEventListener('change', renderCashflow);
document.getElementById('cfFilterFrom').addEventListener('change', renderCashflow);
document.getElementById('cfFilterTo').addEventListener('change', renderCashflow);

/* ===== Đăng nhập / Đăng ký / Phân quyền ===== */

function showAuth(){
  document.getElementById('authOverlay').classList.remove('hidden');
}
function hideAuth(){
  document.getElementById('authOverlay').classList.add('hidden');
}
function showLoginForm(){
  document.getElementById('registerForm').classList.remove('active');
  document.getElementById('loginForm').classList.add('active');
  document.getElementById('loginError').classList.remove('show');
}
function showRegisterForm(){
  document.getElementById('loginForm').classList.remove('active');
  document.getElementById('registerForm').classList.add('active');
  document.getElementById('registerError').classList.remove('show');
}

function populateCustFilterStaff(){
  populateStaffFilterSelect('custFilterStaff');
  populateStaffFilterSelect('cskhFilterStaff');
  populateStaffFilterSelect('orderFilterStaff');
}

function populateStaffFilterSelect(selectId){
  const sel = document.getElementById(selectId);
  const isAdmin = currentUser && currentUser.role === 'admin';
  if(isAdmin){
    sel.innerHTML = `<option value="">Tất cả nhân viên</option>` +
      Object.entries(staffLabel).map(([key,label])=>`<option value="${key}">${escapeHtml(label)}</option>`).join('') +
      `<option value="none">Chưa phân công</option>`;
    sel.disabled = false;
  } else if(currentUser && staffLabel[currentUser.username]){
    // Nhân viên: chỉ được xem khách hàng của chính mình, không đổi được bộ lọc
    sel.innerHTML = `<option value="${currentUser.username}">${escapeHtml(staffLabel[currentUser.username])}</option>`;
    sel.value = currentUser.username;
    sel.disabled = true;
  } else {
    sel.innerHTML = `<option value="">Tất cả nhân viên</option>`;
    sel.disabled = true;
  }
}

function applyRolePermissions(){
  const isAdmin = currentUser && currentUser.role === 'admin';
  populateCustFilterStaff();
  document.getElementById('accountsTab').style.display = isAdmin ? '' : 'none';
  document.getElementById('combosTab').style.display = isAdmin ? '' : 'none';
  document.getElementById('cashflowTab').style.display = isAdmin ? '' : 'none';
  document.getElementById('warehouseTab').style.display = isAdmin ? '' : 'none';
  // Nếu đang ở tab không được phép mà không phải admin, chuyển về tab Khách hàng
  if(!isAdmin && (document.getElementById('view-accounts').classList.contains('active') || document.getElementById('view-combos').classList.contains('active') || document.getElementById('view-cashflow').classList.contains('active') || document.getElementById('view-warehouse').classList.contains('active'))){
    document.querySelector('.tab[data-view="customers"]').click();
  }
  document.querySelectorAll('#customerTableHolder .row-action[data-action="delete"], #cskhTableHolder .row-action[data-action="delete"]').forEach(btn=>{
    btn.style.display = isAdmin ? '' : 'none';
  });
  document.querySelectorAll('#customerTableHolder .row-action[data-action="transfer"], #cskhTableHolder .row-action[data-action="transfer"]').forEach(btn=>{
    btn.style.display = isAdmin ? '' : 'none';
  });
}

function updateUserBadge(){
  if(!currentUser) return;
  document.getElementById('userAvatar').textContent = currentUser.username.charAt(0).toUpperCase();
  document.getElementById('userName').textContent = currentUser.username;
  document.getElementById('userRole').textContent = currentUser.role === 'admin' ? 'Admin' : 'Nhân viên';
}

// Đăng nhập THẬT qua backend: gọi POST /auth/login, lưu JWT token, rồi tải
// toàn bộ dữ liệu thật của tài khoản này về (loadAllData()).
async function loginUser(username, password){
  let res;
  try{
    res = await CrmApi.auth.login(username, password);
  } catch(err){
    document.getElementById('loginError').textContent = err.message || 'Sai tên đăng nhập hoặc mật khẩu.';
    document.getElementById('loginError').classList.add('show');
    return;
  }
  CrmApi.setToken(res.accessToken);
  currentUser = res.user; // { id, username, role }
  updateUserBadge();
  hideAuth();
  await loadAllData();
  // applyRolePermissions() được render() (bên trong loadAllData) tự gọi lại,
  // nên không cần gọi riêng ở đây.
}

document.getElementById('loginBtn').addEventListener('click', ()=>{
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  if(!username || !password){
    document.getElementById('loginError').textContent = 'Vui lòng nhập tên đăng nhập và mật khẩu.';
    document.getElementById('loginError').classList.add('show');
    return;
  }
  loginUser(username, password);
});
document.getElementById('loginPass').addEventListener('keydown', (e)=>{
  if(e.key === 'Enter') document.getElementById('loginBtn').click();
});

// Tự đăng ký tài khoản NHÂN VIÊN mới qua backend (POST /auth/register — công khai,
// LUÔN tạo role='staff' dù form có ô chọn role, để không ai tự đăng ký thành admin).
document.getElementById('registerBtn').addEventListener('click', async ()=>{
  const username = document.getElementById('regUser').value.trim();
  const password = document.getElementById('regPass').value;
  const errEl = document.getElementById('registerError');
  if(!username || !password){
    errEl.textContent = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.';
    errEl.classList.add('show');
    return;
  }
  if(password.length < 6){
    errEl.textContent = 'Mật khẩu tối thiểu 6 ký tự.';
    errEl.classList.add('show');
    return;
  }
  try{
    await CrmApi.auth.register(username, password);
  } catch(err){
    errEl.textContent = err.message || 'Không đăng ký được, vui lòng thử lại.';
    errEl.classList.add('show');
    return;
  }
  errEl.classList.remove('show');
  showLoginForm();
  document.getElementById('loginUser').value = username;
  document.getElementById('loginPass').value = '';
  document.getElementById('regUser').value = '';
  document.getElementById('regPass').value = '';
});

document.getElementById('goRegister').addEventListener('click', showRegisterForm);
document.getElementById('goLogin').addEventListener('click', showLoginForm);

// Cho phép đổi địa chỉ backend NGAY LÚC CHẠY (quan trọng với bản .exe/Electron —
// build 1 lần, nhưng người dùng có thể cần trỏ sang backend khác sau này, vd đổi
// nhà cung cấp hosting). Lưu vào localStorage nên chỉ cần đổi 1 lần / máy.
function updateServerConfigLabel(){
  const el = document.getElementById('serverConfigLabel');
  if(el) el.textContent = 'Đang kết nối: ' + CrmApi.getApiBase();
}
document.getElementById('openServerConfig').addEventListener('click', ()=>{
  const current = CrmApi.getApiBase();
  const next = window.prompt('Nhập địa chỉ máy chủ backend (API):', current);
  if(next === null) return; // bấm Hủy
  const trimmed = next.trim();
  if(!trimmed) return;
  CrmApi.setApiBase(trimmed);
  updateServerConfigLabel();
  appAlert('Đã lưu địa chỉ máy chủ mới:\n' + trimmed + '\n\nVui lòng đăng nhập lại.', {type:'success', title:'✅ Đã cập nhật'});
});
updateServerConfigLabel();

document.getElementById('logoutBtn').addEventListener('click', ()=>{
  CrmApi.clearToken();
  currentUser = null;
  customers = []; combos = []; accounts = []; expenses = []; products = []; stockEntries = []; users = []; userIdByUsername = {};
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  showLoginForm();
  showAuth();
});

document.getElementById('confirmTransferBtn').addEventListener('click', async ()=>{
  if(!transferCustomerId) return;
  const staffUsername = document.getElementById('transferStaff').value;
  const staffUserId = staffUsernameToId(staffUsername);
  try{
    await CrmApi.customers.transfer(transferCustomerId, staffUserId);
  } catch(err){
    appAlert(err.message, {type:'danger', title:'Lỗi chuyển giao'});
    return;
  }
  closeTransferModal();
  await loadAllData();
});
document.getElementById('cancelTransferBtn').addEventListener('click', closeTransferModal);
document.getElementById('closeTransferModal').addEventListener('click', closeTransferModal);
document.getElementById('transferModalOverlay').addEventListener('click', (e)=>{
  if(e.target.id === 'transferModalOverlay') closeTransferModal();
});

document.getElementById('cfDate').value = new Date().toISOString().slice(0,10);
document.getElementById('whDate').value = new Date().toISOString().slice(0,10);
setStockType('nhap');
setComboOfferType('percent');

initEmptyUI();
showAuth();

/* ================= HIỆU ỨNG RIPPLE CHO NÚT BẤM ================= */
document.addEventListener('click', function(e){
  const btn = e.target.closest('.btn, .btn-secondary, .today-btn, .export-btn, .stage-btn, .tab, .row-action, .group-toggle-btn, .cf-type-btn');
  if(!btn) return;
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const dot = document.createElement('span');
  dot.className = 'ripple-dot';
  dot.style.width = dot.style.height = size + 'px';
  dot.style.left = (e.clientX - rect.left - size/2) + 'px';
  dot.style.top = (e.clientY - rect.top - size/2) + 'px';
  btn.appendChild(dot);
  setTimeout(()=>dot.remove(), 600);
});
