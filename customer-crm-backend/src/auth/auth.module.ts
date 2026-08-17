// ============================================================================
// AuthModule: đăng ký JwtModule (cấu hình secret/thời hạn token), PassportModule,
// JwtStrategy, cùng Controller/Service xử lý đăng nhập.
// ============================================================================
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    UsersModule, // để AuthService inject được UsersService
    PassportModule, // hạ tầng chung cho các strategy (jwt, local...)

    // registerAsync: cấu hình JwtModule "muộn" (sau khi ConfigModule đã đọc xong .env),
    // thay vì hardcode secret trực tiếp trong code.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService], // Nest sẽ tiêm ConfigService vào hàm factory bên dưới
      useFactory: async (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        // Ép kiểu "as any": bản @nestjs/jwt mới đòi "expiresIn" phải khớp kiểu
        // StringValue rất chặt (vd '12h', '7d'...) từ package "ms", nhưng giá trị
        // đọc từ .env luôn chỉ là "string" thường -> TS không tự suy ra được là hợp lệ.
        // Ép kiểu ở đây an toàn vì giá trị thực tế vẫn đúng định dạng ("12h", "7d"...).
        signOptions: { expiresIn: (config.get<string>('JWT_EXPIRES_IN') ?? '12h') as any },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
