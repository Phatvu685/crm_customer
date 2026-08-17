import { IsEnum, IsInt, IsNotEmpty, IsNumber, IsOptional, IsPositive, IsString, Min } from 'class-validator';
import { StockType } from '@prisma/client';

export class CreateStockEntryDto {
  @IsEnum(StockType, { message: 'type phải là nhap hoặc xuat' })
  type: StockType;

  @IsInt()
  @IsPositive()
  productId: number;

  @IsNumber()
  @Min(0)
  qty: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsString()
  supplier?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
