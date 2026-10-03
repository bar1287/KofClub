import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { AdminController } from './admin.controller';
import { AdminRepository } from './admin.repository';
import { AdminService } from './admin.service';
import { PlatformAdminGuard } from './platform-admin.guard';

@Module({
  imports: [IdentityModule],
  controllers: [AdminController],
  providers: [AdminService, AdminRepository, PlatformAdminGuard],
})
export class AdminModule {}
