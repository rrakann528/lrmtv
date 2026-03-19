import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import hlsProxyRouter from "./hls-proxy";
import youtubeSearchRouter from "./youtube-search";
import authRouter from "./auth";
import oauthRouter from "./oauth";
import friendsRouter from "./friends";
import pushRouter from "./push";
import dmRouter from "./dm";
import storageRouter from "./storage";
import subtitlesRouter from "./subtitles";
import adminRouter from "./admin";
import vastProxyRouter from "./vast-proxy";
import groupsRouter from "./groups";

const router: IRouter = Router();

router.use(authRouter);
router.use(oauthRouter);
router.use(friendsRouter);
router.use(pushRouter);
router.use(dmRouter);
router.use(healthRouter);
router.use(roomsRouter);
router.use(hlsProxyRouter);
router.use(youtubeSearchRouter);
router.use(storageRouter);
router.use(subtitlesRouter);
router.use(adminRouter);
router.use(vastProxyRouter);
router.use(groupsRouter);

export default router;
