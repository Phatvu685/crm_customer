// ============================================================================
// QueryCustomerDto: các query param cho phép lọc danh sách khách hàng,
// port lại từ bộ lọc trong renderCustomerList()/renderOrders() bản gốc.
// ============================================================================
import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { CustomerStage, CustomerType, PaymentStatus } from '@prisma/client';

export class QueryCustomerDto {
  @IsOptional()
  @IsEnum(CustomerStage)
  stage?: CustomerStage; // lọc theo tab: 'order' hoặc 'cskh'

  @IsOptional()
  @IsString()
  search?: string; // tìm theo tên hoặc số điện thoại

  @IsOptional()
  @IsEnum(CustomerType)
  type?: CustomerType;

  @IsOptional()
  @IsString()
  staffUserId?: string; // truyền "none" để lọc khách CHƯA phân công, hoặc id dạng chuỗi số

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  @IsOptional()
  @IsIn(['da', 'chua'])
  packed?: 'da' | 'chua';

  @IsOptional()
  @IsIn(['da', 'chua'])
  delivered?: 'da' | 'chua';

  @IsOptional()
  @IsString()
  fromDate?: string; // dùng cho tab Đơn hàng: lọc theo khoảng ngày

  @IsOptional()
  @IsString()
  toDate?: string;

  // Chỉ lấy khách đã có giá trị đơn (price > 0) — dùng cho tab "Đơn hàng"
  @IsOptional()
  @IsIn(['true', 'false'])
  onlyOrders?: 'true' | 'false';
}
