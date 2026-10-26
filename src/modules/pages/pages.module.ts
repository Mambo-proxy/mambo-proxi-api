import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { PagesController } from './pages.controller.js';
import { PagesService } from './pages.service.js';

@Module({
  imports: [MediaModule],
  controllers: [PagesController],
  providers: [PagesService],
})
export class PagesModule {}
